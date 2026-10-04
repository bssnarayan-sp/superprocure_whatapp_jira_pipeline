class ThreadService {
  constructor(pool) {
    this.pool = pool;
  }

  async getThreads(page, pageSize) {
    const offset = (page - 1) * pageSize;

    const [countResult, threadsResult] =
      await Promise.all([
        this.pool.query(`
          SELECT COUNT(*)::int AS total
          FROM support_threads
        `),

        this.pool.query(`
          SELECT
            thread_id,
            started_by,
            started_at,
            summary,
            classification,
            severity,
            jira_key,
            jira_status,
            jira_url,
            customer,
            module,
            last_message_at
          FROM support_threads
          ORDER BY last_message_at DESC NULLS LAST
          LIMIT $1 OFFSET $2
        `, [pageSize, offset])
      ]);

    const total = countResult.rows[0].total;

    return {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      threads: threadsResult.rows
    };
  }

  async getMessages(threadId) {
    const result = await this.pool.query(`
      SELECT
        message_id,
        thread_id,
        reply_to_message_id,
        sender,
        message_timestamp,
        text,
        attachments,
        jira_synced
      FROM support_messages
      WHERE thread_id = $1
      ORDER BY message_timestamp ASC
    `, [threadId]);

    return result.rows;
  }
}

module.exports = ThreadService;