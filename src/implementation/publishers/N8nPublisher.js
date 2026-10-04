const MessagePublisher =
    require("../../domain/interfaces/MessagePublisher");

class N8nPublisher extends MessagePublisher {
    constructor(webhookUrl) {
        super();
        this.webhookUrl = webhookUrl;
    }

    async publish(thread) {
        const response =
            await fetch(
                this.webhookUrl,
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body:
                        JSON.stringify(thread)
                }
            );

        if (!response.ok) {
            const body =
                await response.text();

            throw new Error(
                `n8n publish failed: ${response.status} ${body}`
            );
        }

        return true;
    }
}

module.exports =
    N8nPublisher;