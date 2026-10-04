CREATE TABLE support_threads (
    thread_id VARCHAR(255) PRIMARY KEY,

    started_by VARCHAR(255),
    started_at TIMESTAMP,

    conversation_text TEXT,

    classification VARCHAR(50),
    summary TEXT,
    description TEXT,
    customer VARCHAR(255),
    module VARCHAR(255),
    severity VARCHAR(50),

    jira_key VARCHAR(50),
    jira_status VARCHAR(100),
    jira_url TEXT,

    last_message_at TIMESTAMP,

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_support_threads_last_message_at
ON support_threads(last_message_at DESC);

CREATE INDEX idx_support_threads_jira_key
ON support_threads(jira_key);

CREATE INDEX idx_support_threads_classification
ON support_threads(classification);

CREATE INDEX idx_support_threads_jira_status
ON support_threads(jira_status);