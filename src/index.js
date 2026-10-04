require("dotenv").config();

const WhatsAppWebSource =
    require("./implementation/whatsapp-web/WhatsAppWebSource");
const BuildThreads =
    require("./application/services/BuildThreads");
const createPostgresPool =
    require("./implementation/database/createPostgresPool");
const PostgresThreadRepository =
    require("./implementation/database/PostgresThreadRepository");
const N8nPublisher =
    require("./implementation/publishers/N8nPublisher");

const POLL_INTERVAL_MS = 30000;

async function main() {
    const pool = createPostgresPool();

    const repository =
        new PostgresThreadRepository(pool);

    const source =
        new WhatsAppWebSource();

    const buildThreads =
        new BuildThreads(repository);

    const publisher =
        new N8nPublisher(process.env.N8N_WEBHOOK_URL);

    await source.initialize();

    await source.openChat(
        "SuperProcure Control Room"
    );

    console.log("WhatsApp crawler started.");

    let running = false;

    async function poll() {
        if (running) {
            console.log("Previous poll still running. Skipping.");
            return;
        }

        running = true;

        try {
            console.log("Checking WhatsApp...");

            const rawMessages =
                await source.getRawMessages();

            const threads =
                await buildThreads.execute(rawMessages);

            for (const thread of threads) {
                await repository.saveThread(thread);

                await repository.saveMessages(
                    thread.messages
                );

                const fullThread =
                    await repository.getThread(
                        thread.threadId
                    );

                if (!fullThread) continue;

                // n8n is optional
                try {
                    if (
                        fullThread.jiraKey &&
                        (!fullThread.unsyncedMessages ||
                            fullThread.unsyncedMessages.length === 0)
                    ) {
                        continue;
                    }

                    await publisher.publish(fullThread);
                    console.log(
                        `Published ${fullThread.threadId} to n8n`
                    );

                } catch (n8nError) {
                    console.error(
                        `n8n unavailable for thread ${fullThread.threadId}:`,
                        n8nError.message
                    );

                    // Do NOT fail crawler
                    // Do NOT remove/update messages
                    // Dashboard can still show them
                }
            }

        } catch (error) {
            console.error(
                "Crawler poll failed:",
                error
            );
        } finally {
            running = false;
        }
    }

    // Run immediately
    await poll();

    // Then continuously
    setInterval(
        poll,
        POLL_INTERVAL_MS
    );
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});