class ThreadRepository {
    async findMessageById(messageId) {
        throw new Error(
            "findMessageById() must be implemented"
        );
    }

    async findMessageByReplyContext({
        sender,
        text
    }) {
        throw new Error(
            "findMessageByReplyContext() must be implemented"
        );
    }

    async saveThread(thread) {
        throw new Error(
            "saveThread() must be implemented"
        );
    }

    async saveMessages(messages) {
        throw new Error(
            "saveMessages() must be implemented"
        );
    }
    
    async getThread(threadId) {
        throw new Error(
            "getThread() must be implemented"
        );
    }
}

module.exports = ThreadRepository;