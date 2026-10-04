class MessagePublisher {
  async publish(thread) {
    throw new Error("publish() must be implemented");
  }
}

module.exports = MessagePublisher;