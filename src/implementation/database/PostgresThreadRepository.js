const ThreadRepository =
    require("../../domain/interfaces/ThreadRepository");

class PostgresThreadRepository extends ThreadRepository {
    constructor(pool) {
        super();
        this.pool = pool;
    }

    async findMessageById(messageId) {
        const result =
            await this.pool.query(
                `
                SELECT
                    message_id,
                    thread_id,
                    reply_to_message_id,
                    sender,
                    message_timestamp,
                    text
                FROM support_messages
                WHERE message_id = $1
                `,
                [messageId]
            );

        return result.rows[0] || null;
    }

    async findMessageByReplyContext({
        sender,
        text
    }) {
        if (!text) {
            return null;
        }

        /*
         * Don't depend completely on sender.
         *
         * WhatsApp may show:
         *   "Anni"
         *
         * while metadata contains:
         *   "+91 98..."
         *
         * So retrieve recent candidates and
         * perform normalized text matching here.
         */
        const result =
            await this.pool.query(`
                SELECT
                    message_id,
                    thread_id,
                    reply_to_message_id,
                    sender,
                    message_timestamp,
                    text
                FROM support_messages
                WHERE text IS NOT NULL
                ORDER BY message_timestamp DESC
                LIMIT 300
            `);

        const quotedText =
            this.normalizeText(text);

        if (!quotedText) {
            return null;
        }

        for (const row of result.rows) {
            const candidateText =
                this.normalizeText(
                    row.text
                );

            if (!candidateText) {
                continue;
            }

            if (
                candidateText === quotedText ||
                candidateText.includes(quotedText) ||
                quotedText.includes(candidateText) ||
                this.prefixMatches(
                    candidateText,
                    quotedText
                )
            ) {
                return {
                    messageId:
                        row.message_id,

                    threadId:
                        row.thread_id,

                    replyToMessageId:
                        row.reply_to_message_id,

                    sender:
                        row.sender,

                    timestamp:
                        row.message_timestamp,

                    text:
                        row.text
                };
            }
        }

        return null;
    }

    async saveThread(thread) {
        const startedAt =
            this.parseWhatsAppTimestamp(
                thread.timestamp
            );

        const lastMessage =
            thread.messages[
            thread.messages.length - 1
            ];

        const lastMessageAt =
            this.parseWhatsAppTimestamp(
                lastMessage?.timestamp
            );

        await this.pool.query(
            `
        INSERT INTO support_threads (
            thread_id,
            started_by,
            started_at,
            conversation_text,
            last_message_at
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            $5
        )

        ON CONFLICT (thread_id)
        DO UPDATE SET
            last_message_at =
                GREATEST(
                    support_threads.last_message_at,
                    EXCLUDED.last_message_at
                ),

            updated_at = NOW()
        `,
            [
                thread.threadId,
                thread.sender,
                startedAt,
                thread.text,
                lastMessageAt
            ]
        );
    }

    async saveMessages(messages) {
        for (const message of messages) {
            await this.pool.query(
                `
                INSERT INTO support_messages (
                    message_id,
                    thread_id,
                    reply_to_message_id,
                    sender,
                    message_timestamp,
                    text,
                    attachments
                )
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7::jsonb
                )

                ON CONFLICT (message_id)
                DO UPDATE SET
                    thread_id =
                        EXCLUDED.thread_id,

                    reply_to_message_id =
                        EXCLUDED.reply_to_message_id,

                    sender =
                        EXCLUDED.sender,

                    message_timestamp =
                        EXCLUDED.message_timestamp,

                    text =
                        EXCLUDED.text,

                    attachments =
                        EXCLUDED.attachments
                `,
                [
                    message.messageId,
                    message.threadId,
                    message.replyToMessageId,
                    message.sender,
                    this.parseWhatsAppTimestamp(
                        message.timestamp
                    ),
                    message.text,
                    JSON.stringify(
                        message.attachments || []
                    )
                ]
            );
        }
    }

    normalizeText(value) {
        return (value || "")
            .replace(/…/g, "...")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    }

    prefixMatches(
        candidate,
        quoted
    ) {
        const cleanQuoted =
            quoted
                .replace(/\.\.\.$/, "")
                .trim();

        if (
            cleanQuoted.length < 10
        ) {
            return false;
        }

        return candidate.startsWith(
            cleanQuoted
        );
    }

    parseWhatsAppTimestamp(value) {
        if (!value) {
            return null;
        }

        /*
         * Expected:
         * 3/10/2026 10:20 am
         * 28/9/2026 6:32 pm
         */
        const match =
            value.match(
                /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)$/i
            );

        if (!match) {
            return null;
        }

        const [
            ,
            day,
            month,
            year,
            rawHour,
            minute,
            meridian
        ] = match;

        let hour =
            Number(rawHour);

        if (
            meridian.toLowerCase() === "pm" &&
            hour !== 12
        ) {
            hour += 12;
        }

        if (
            meridian.toLowerCase() === "am" &&
            hour === 12
        ) {
            hour = 0;
        }

        return new Date(
            Number(year),
            Number(month) - 1,
            Number(day),
            hour,
            Number(minute),
            0
        );
    }

    async getThread(threadId) {
        const threadResult =
            await this.pool.query(
                `
            SELECT
                thread_id,
                started_by,
                started_at,
                conversation_text,
                classification,
                summary,
                description,
                customer,
                module,
                severity,
                jira_key,
                jira_status,
                jira_url,
                last_message_at
            FROM support_threads
            WHERE thread_id = $1
            `,
                [threadId]
            );

        if (threadResult.rows.length === 0) {
            return null;
        }

        const messageResult = await this.pool.query(`
            SELECT
                message_id,
                thread_id,
                reply_to_message_id,
                sender,
                message_timestamp,
                text,
                attachments,
                jira_synced,
                jira_synced_at
            FROM support_messages
            WHERE thread_id = $1
            ORDER BY message_timestamp ASC
            `, [threadId]);

        const row =
            threadResult.rows[0];

        const messages = messageResult.rows.map(m => ({
            messageId: m.message_id,
            threadId: m.thread_id,
            replyToMessageId: m.reply_to_message_id,
            sender: m.sender,
            timestamp: m.message_timestamp,
            text: m.text,
            attachments: m.attachments || [],
            jiraSynced: m.jira_synced,
            jiraSyncedAt: m.jira_synced_at
        }));

        const conversationText =
            messages
                .map(
                    (message) =>
                        `[${message.timestamp}] ${message.sender}: ${message.text}`
                )
                .join("\n");

        const unsyncedMessages = messages.filter(
            message => !message.jiraSynced
        );

        return {
            threadId: row.thread_id,
            sender: row.started_by,
            timestamp: row.started_at,
            text: conversationText,

            classification: row.classification,
            summary: row.summary,
            description: row.description,
            customer: row.customer,
            module: row.module,
            severity: row.severity,

            jiraKey: row.jira_key,
            jiraStatus: row.jira_status,
            jiraUrl: row.jira_url,

            lastMessageAt: row.last_message_at,

            messages,
            unsyncedMessages
        };
    }

    async updateClassification(threadId, result) {
        await this.pool.query(`
    UPDATE support_threads
    SET
      classification = $1,
      summary = $2,
      description = $3,
      customer = $4,
      module = $5,
      severity = $6,
      updated_at = NOW()
    WHERE thread_id = $7
  `, [
            result.classification,
            result.summary,
            result.description,
            result.customer,
            result.module,
            result.severity,
            threadId
        ]);
    }
}

module.exports =
    PostgresThreadRepository;