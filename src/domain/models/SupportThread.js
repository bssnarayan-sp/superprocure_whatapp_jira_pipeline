class SupportThread {
  constructor({
    threadId,
    sender,
    timestamp,
    text,
    attachments = [],
    isUpdate = false,
    messages = [],
    newMessageIds = []
  }) {
    this.threadId = threadId;
    this.sender = sender;
    this.timestamp = timestamp;
    this.text = text;
    this.attachments = attachments;
    this.isUpdate = isUpdate;
    this.messages = messages;
    this.newMessageIds = newMessageIds;
  }
}

module.exports = SupportThread;