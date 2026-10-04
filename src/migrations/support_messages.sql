CREATE TABLE support_messages (
    message_id VARCHAR(255) PRIMARY KEY,

    thread_id VARCHAR(255) NOT NULL,
    reply_to_message_id VARCHAR(255),

    sender VARCHAR(255),
    message_timestamp TIMESTAMP,

    text TEXT,
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,

    jira_synced BOOLEAN NOT NULL DEFAULT FALSE,
    jira_synced_at TIMESTAMP,

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_support_messages_thread
        FOREIGN KEY (thread_id)
        REFERENCES support_threads(thread_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_support_messages_thread_id
ON support_messages(thread_id);

CREATE INDEX idx_support_messages_reply_to_message_id
ON support_messages(reply_to_message_id);

CREATE INDEX idx_support_messages_message_timestamp
ON support_messages(message_timestamp DESC);

CREATE INDEX idx_support_messages_thread_timestamp
ON support_messages(thread_id, message_timestamp ASC);

CREATE INDEX idx_support_messages_unsynced
ON support_messages(thread_id, jira_synced)
WHERE jira_synced = FALSE;

ALTER TABLE support_threads
ADD COLUMN jira_processing_status VARCHAR(30)
DEFAULT 'pending';