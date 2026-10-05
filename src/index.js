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
const GroqThreadClassifier =
    require("./implementation/ai/GroqThreadClassifier");

const POLL_INTERVAL_MS = 30000;

async function main() {
    const pool = createPostgresPool();

    const repository =
        new PostgresThreadRepository(pool);

    const source =
        new WhatsAppWebSource();

    const buildThreads =
        new BuildThreads(repository);

    const classifier =
        new GroqThreadClassifier();

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

            if (!(await source.isAlive())) {
                await source.reconnect();
            }

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

                /*// n8n is optional
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
                }*/

                if (
                    !fullThread.text ||
                    !fullThread.text.trim()
                ) {
                    console.log(
                        `Skipping empty thread ${fullThread.threadId}`
                    );
                    continue;
                }

                // Already classified → don't call Groq again

                if (fullThread.classification) {
                    console.log(
                        `Skipping already classified thread ${fullThread.threadId}`
                    );
                    continue;
                }

                try {

                    const result =
                        await classifier.classify(fullThread);

                    await repository.updateClassification(
                        thread.threadId,
                        result
                    );

                    console.log(
                        `Classified ${thread.threadId}: ${result.classification}`
                    );

                } catch (error) {
                    console.error(
                        `Classification failed ${thread.threadId}:`,
                        error.message
                    );
                }
            }

        } catch (error) {
            console.error(
                "Crawler poll failed:",
                error
            );

            const browserClosed =
                error.message.includes("Target page") ||
                error.message.includes("browser has been closed") ||
                error.message.includes("context or browser has been closed");

            if (browserClosed) {
                try {
                    await source.reconnect();
                    console.log(
                        "WhatsApp browser recovered."
                    );

                } catch (reconnectError) {
                    console.error(
                        "WhatsApp reconnect failed:",
                        reconnectError.message
                    );
                }
            }
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