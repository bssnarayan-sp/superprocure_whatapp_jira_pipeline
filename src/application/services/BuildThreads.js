const SupportThread =
    require("../../domain/models/SupportThread");

const ThreadMessage =
    require("../../domain/models/ThreadMessage");

class BuildThreads {
    constructor(threadRepository) {
        this.threadRepository =
            threadRepository;
    }

    async execute(rawMessages) {
        const messageMap =
            new Map();

        /*
         * Convert raw messages to domain objects.
         */
        for (const raw of rawMessages) {
            const message =
                new ThreadMessage({
                    messageId:
                        raw.messageId,

                    sender:
                        raw.sender,

                    timestamp:
                        raw.timestamp,

                    text:
                        raw.text,

                    attachments:
                        raw.attachments || [],

                    replyToMessageId:
                        raw.replyToMessageId || null,

                    isNew:
                        false
                });

            messageMap.set(
                message.messageId,
                message
            );
        }

        /*
         * Important:
         * some replies reference messages outside
         * the current WhatsApp render window.
         *
         * Resolve those against Postgres.
         */
        for (const raw of rawMessages) {
            if (
                raw.replyToMessageId ||
                !raw.replyContext?.text
            ) {
                continue;
            }

            const historicalParent =
                await this.threadRepository
                    .findMessageByReplyContext({
                        sender:
                            raw.replyContext.sender,

                        text:
                            raw.replyContext.text
                    });

            if (!historicalParent) {
                continue;
            }

            const message =
                messageMap.get(
                    raw.messageId
                );

            message.replyToMessageId =
                historicalParent.messageId;

            /*
             * We also remember the already-known
             * historical thread root.
             */
            message.historicalThreadId =
                historicalParent.threadId;

            console.log(
                `Resolved historical parent: ${message.messageId} -> ${historicalParent.messageId}, thread ${historicalParent.threadId}`
            );
        }

        const threadGroups =
            new Map();

        for (const message of messageMap.values()) {
            const threadId =
                this.resolveThreadId(
                    message,
                    messageMap
                );

            message.threadId =
                threadId;

            if (!threadGroups.has(threadId)) {
                threadGroups.set(
                    threadId,
                    []
                );
            }

            threadGroups
                .get(threadId)
                .push(message);
        }

        const threads = [];

        for (
            const [
                threadId,
                messages
            ] of threadGroups.entries()
        ) {
            const root =
                messageMap.get(threadId);

            /*
             * If the root is historical, it won't
             * be in the current WhatsApp window.
             */
            const sender =
                root?.sender ||
                messages[0]?.sender;

            const timestamp =
                root?.timestamp ||
                messages[0]?.timestamp;

            const conversationText =
                messages
                    .map(
                        message =>
                            `[${message.timestamp}] ${message.sender}: ${message.text}`
                    )
                    .join("\n");

            const attachments =
                messages.flatMap(
                    message =>
                        message.attachments || []
                );

            threads.push(
                new SupportThread({
                    threadId,
                    sender,
                    timestamp,
                    text:
                        conversationText,
                    attachments,
                    isUpdate:
                        !root,
                    messages,
                    newMessageIds:
                        messages.map(
                            message =>
                                message.messageId
                        )
                })
            );
        }

        return threads;
    }

    resolveThreadId(
        message,
        messageMap,
        visited = new Set()
    ) {
        /*
         * Parent was found historically.
         */
        if (
            message.historicalThreadId
        ) {
            return message
                .historicalThreadId;
        }

        if (
            visited.has(
                message.messageId
            )
        ) {
            return message.messageId;
        }

        visited.add(
            message.messageId
        );

        if (
            !message.replyToMessageId
        ) {
            return message.messageId;
        }

        const parent =
            messageMap.get(
                message.replyToMessageId
            );

        /*
         * Parent not currently visible.
         * If we didn't resolve it from DB,
         * treat this message as a root for now.
         */
        if (!parent) {
            return message.messageId;
        }

        return this.resolveThreadId(
            parent,
            messageMap,
            visited
        );
    }
}

module.exports =
    BuildThreads;