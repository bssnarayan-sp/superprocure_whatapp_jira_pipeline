const { chromium } = require("playwright");

const MessageSource =
    require("../../domain/interfaces/MessageSource");

class WhatsAppWebSource extends MessageSource {
    constructor() {
        super();

        this.context = null;
        this.page = null;
        this.currentChat = null;
    }

    async initialize() {
        this.context =
            await chromium.launchPersistentContext(
                "./data/whatsapp-profile",
                {
                    headless: false
                }
            );

        const pages = this.context.pages();

        this.page =
            pages.length > 0
                ? pages[0]
                : await this.context.newPage();

        await this.page.goto(
            "https://web.whatsapp.com"
        );

        await this.page.waitForSelector(
            "#pane-side",
            {
                timeout: 0
            }
        );

        console.log("WhatsApp Web ready.");
    }

    async openChat(chatName) {
        const chat =
            this.page.locator(
                `#pane-side span[title="${chatName}"]`
            );

        await chat.first().waitFor({
            state: "visible",
            timeout: 10000
        });

        await chat.first().click();

        this.currentChat = chatName;

        console.log(
            `Opened chat: ${chatName}`
        );
    }

    async getRawMessages() {
        const main =
            this.page.locator("#main");

        await this.page.waitForTimeout(1000);

        const items =
            main.locator(
                ".focusable-list-item"
            );

        const count =
            await items.count();

        console.log(
            `Found ${count} rendered items`
        );

        const messages = [];

        for (
            let i = 0;
            i < count;
            i++
        ) {
            const item =
                items.nth(i);

            const messageId =
                await item.evaluate(
                    (element) => {
                        const root =
                            element.closest(
                                '[data-testid^="conv-msg-"]'
                            );

                        return root
                            ? root.getAttribute("data-id")
                            : null;
                    }
                );

            if (!messageId) {
                continue;
            }

            const metadataLocator =
                item.locator(
                    "[data-pre-plain-text]"
                ).first();

            if (
                await metadataLocator.count()
                === 0
            ) {
                continue;
            }

            const metadata =
                await metadataLocator.getAttribute(
                    "data-pre-plain-text"
                );

            const parsed =
                this.parseMetadata(metadata);

            const text =
                await this.extractText(item);

            const attachments =
                await this.extractAttachments(
                    item,
                    messageId
                );

            const replyContext =
                await this.extractReplyContext(item);

            messages.push({
                messageId,
                sender: parsed.sender,
                timestamp:
                    `${parsed.date} ${parsed.time}`,
                text,
                attachments,
                replyContext,
                replyToMessageId: null,
            });
        }

        console.log(
            `Parsed ${messages.length} messages`
        );

        const resolvedMessages =
            this.resolveReplyLinks(messages);

        return resolvedMessages;
    }

    async extractText(item) {
        return item.evaluate(
            (element) => {
                const clone =
                    element.cloneNode(true);

                clone
                    .querySelectorAll(
                        '[data-testid="quoted-message"]'
                    )
                    .forEach(
                        (node) => node.remove()
                    );

                const selector =
                    '[data-testid*="selectable-text"]';

                const candidates =
                    Array.from(
                        clone.querySelectorAll(
                            selector
                        )
                    );

                const topLevel =
                    candidates.filter(
                        (node) =>
                            !node.parentElement
                                ?.closest(selector)
                    );

                return topLevel
                    .map(
                        (node) =>
                            node.innerText?.trim()
                    )
                    .filter(Boolean)
                    .join("\n")
                    .trim();
            }
        );
    }

    async extractAttachments(
        item,
        messageId
    ) {
        const attachments = [];

        const imageThumb =
            item.locator(
                '[data-testid="image-thumb"]'
            );

        if (
            await imageThumb.count()
            > 0
        ) {
            const image =
                imageThumb.locator("img").last();

            const result =
                await image.evaluate(
                    async (img) => {
                        const response =
                            await fetch(img.src);

                        const blob =
                            await response.blob();

                        const buffer =
                            await blob.arrayBuffer();

                        const bytes =
                            new Uint8Array(buffer);

                        let binary = "";

                        for (
                            let i = 0;
                            i < bytes.length;
                            i++
                        ) {
                            binary +=
                                String.fromCharCode(
                                    bytes[i]
                                );
                        }

                        return {
                            mimeType:
                                blob.type ||
                                "image/jpeg",

                            base64:
                                btoa(binary)
                        };
                    }
                );

            attachments.push({
                type: "image",
                mimeType:
                    result.mimeType,
                fileName:
                    `${messageId}.jpg`,
                base64:
                    result.base64
            });
        }

        return attachments;
    }

    parseMetadata(metadata) {
        const match =
            metadata.match(
                /^\[([^,]+),\s*([^\]]+)\]\s*(.*?):\s*$/
            );

        if (!match) {
            return {
                time: null,
                date: null,
                sender: null
            };
        }

        return {
            time:
                match[1].trim(),
            date:
                match[2].trim(),
            sender:
                match[3].trim()
        };
    }

    async extractReplyContext(item) {
        return item.evaluate((element) => {
            const quoted =
                element.querySelector(
                    '[data-testid="quoted-message"]'
                );

            if (!quoted) {
                return null;
            }

            const author =
                quoted.querySelector(
                    '[data-testid="author"]'
                );

            const textNodes =
                quoted.querySelectorAll(
                    '[data-testid*="selectable-text"]'
                );

            const text =
                Array.from(textNodes)
                    .map(node => node.innerText?.trim())
                    .filter(Boolean)
                    .join("\n")
                    .trim();

            return {
                sender:
                    author?.innerText?.trim() || null,
                text
            };
        });
    }

    resolveReplyLinks(messages) {
        for (let i = 0; i < messages.length; i++) {
            const current = messages[i];

            if (!current.replyContext?.text) {
                continue;
            }

            const quotedText =
                this.normalizeText(
                    current.replyContext.text
                );

            if (!quotedText) {
                continue;
            }

            for (let j = i - 1; j >= 0; j--) {
                const candidate = messages[j];

                const candidateText =
                    this.normalizeText(
                        candidate.text
                    );

                if (!candidateText) {
                    continue;
                }

                const textMatches =
                    candidateText === quotedText ||
                    candidateText.includes(quotedText) ||
                    quotedText.includes(candidateText) ||
                    candidateText.startsWith(
                        quotedText.replace(/\.\.\.$/, "")
                    );

                if (textMatches) {
                    current.replyToMessageId =
                        candidate.messageId;

                    break;
                }
            }
        }

        return messages;
    }

    normalizeText(value) {
        return (value || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    }
}

module.exports =
    WhatsAppWebSource;