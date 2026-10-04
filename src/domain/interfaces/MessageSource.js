class MessageSource {
    async getRawMessages() {
        throw new Error(
            "getRawMessages() must be implemented"
        );
    }
}

module.exports = MessageSource;