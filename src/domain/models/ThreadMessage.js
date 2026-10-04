class ThreadMessage {
    constructor({
        messageId,
        threadId = null,
        sender,
        timestamp,
        text,
        attachments = [],
        replyToMessageId = null,
        isNew = false
    }) {
        this.messageId =
            messageId;

        this.threadId =
            threadId;

        this.sender =
            sender;

        this.timestamp =
            timestamp;

        this.text =
            text;

        this.attachments =
            attachments;

        this.replyToMessageId =
            replyToMessageId;

        this.isNew =
            isNew;
    }
}

module.exports =
    ThreadMessage;