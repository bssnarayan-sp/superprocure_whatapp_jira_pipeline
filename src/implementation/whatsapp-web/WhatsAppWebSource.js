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
        const chat = this.page.locator(
            `#pane-side span[title="${chatName}"]`
        );

        await chat
            .first()
            .waitFor({
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

        for (let i = 0; i < count; i++) {
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
                            ? root.getAttribute(
                                "data-id"
                            )
                            : null;
                    }
                );

            if (!messageId) {
                continue;
            }

            const metadataLocator =
                item.locator("[data-pre-plain-text]").first();

            let metadata = null;

            if (await metadataLocator.count() > 0) {
                metadata =
                    await metadataLocator.getAttribute(
                        "data-pre-plain-text"
                    );
            }

            const parsed = metadata
                ? this.parseMetadata(metadata)
                : {
                    sender: null,
                    date: null,
                    time: null
                };

            let text =
                await this.extractText(item);

            const attachments =
                await this.extractAttachments(
                    item,
                    messageId
                );

            // Important:
            // image-only WhatsApp messages otherwise have empty text.
            if (
                !text &&
                attachments.length > 0
            ) {
                text = "[Image]";
            }

            const replyContext =
                await this.extractReplyContext(
                    item
                );

            messages.push({
                messageId,

                sender:
                    parsed.sender,

                timestamp:
                    parsed.date && parsed.time
                        ? `${parsed.date} ${parsed.time}`
                        : null,

                text,

                attachments,

                replyContext,

                replyToMessageId: null
            });
        }

        console.log(
            `Parsed ${messages.length} messages`
        );

        // Temporary diagnostic.
        // Useful specifically for image / quoted image replies.
        console.dir(
            messages.map(
                message => ({
                    messageId:
                        message.messageId,

                    text:
                        message.text,

                    attachments:
                        message.attachments
                            ?.length || 0,

                    replyContext:
                        message.replyContext,

                    replyToMessageId:
                        message.replyToMessageId
                })
            ),
            {
                depth: null
            }
        );

        return this.resolveReplyLinks(
            messages
        );
    }

    async extractText(item) {
        return item.evaluate(
            (element) => {
                const clone =
                    element.cloneNode(true);

                // Remove quoted reply text so it
                // does not become part of actual message text.
                clone
                    .querySelectorAll(
                        '[data-testid="quoted-message"]'
                    )
                    .forEach(
                        node =>
                            node.remove()
                    );

                const selector =
                    '[data-testid*="selectable-text"]';

                const candidates =
                    Array.from(
                        clone.querySelectorAll(
                            selector
                        )
                    );

                // Avoid nested duplicate selectable-text nodes.
                const topLevel =
                    candidates.filter(
                        node =>
                            !node.parentElement
                                ?.closest(
                                    selector
                                )
                    );

                return topLevel
                    .map(
                        node =>
                            node.innerText
                                ?.trim()
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
            await imageThumb.count() > 0
        ) {
            const image =
                imageThumb
                    .locator("img")
                    .last();

            const result =
                await image.evaluate(
                    async img => {
                        const response =
                            await fetch(
                                img.src
                            );

                        const blob =
                            await response.blob();

                        const buffer =
                            await blob.arrayBuffer();

                        const bytes =
                            new Uint8Array(
                                buffer
                            );

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

    async extractReplyContext(
        item
    ) {
        return item.evaluate(
            (element) => {
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
                    Array.from(
                        textNodes
                    )
                        .map(
                            node =>
                                node.innerText
                                    ?.trim()
                        )
                        .filter(Boolean)
                        .join("\n")
                        .trim();

                // WhatsApp quoted images are not
                // always represented the same way.
                const hasImage =
                    !!quoted.querySelector(
                        "img"
                    ) ||
                    !!quoted.querySelector(
                        '[data-testid="image-thumb"]'
                    ) ||
                    !!quoted.querySelector(
                        '[data-icon="image"]'
                    );

                return {
                    sender:
                        author
                            ?.innerText
                            ?.trim() ||
                        null,

                    text,

                    hasImage
                };
            }
        );
    }

    resolveReplyLinks(messages) {
        for (
            let i = 0;
            i < messages.length;
            i++
        ) {
            const current =
                messages[i];

            if (
                !current.replyContext
            ) {
                continue;
            }

            const replyText =
                this.normalizeText(
                    current
                        .replyContext
                        .text
                );

            const isImageReply =
                current.replyContext
                    .hasImage ||
                replyText ===
                "photo" ||
                replyText ===
                "image" ||
                replyText ===
                "[image]";

            // Special case:
            // reply is quoting an image-only message.
            if (isImageReply) {
                for (
                    let j = i - 1;
                    j >= 0;
                    j--
                ) {
                    const candidate =
                        messages[j];

                    if (
                        candidate.attachments?.length > 0
                    ) {
                        current.replyToMessageId =
                            candidate.messageId;

                        if (
                            !candidate.sender &&
                            current.replyContext?.sender
                        ) {
                            candidate.sender =
                                current.replyContext.sender;
                        }

                        break;
                    }
                }

                continue;
            }

            if (!replyText) {
                continue;
            }

            // Normal quoted text matching.
            for (
                let j = i - 1;
                j >= 0;
                j--
            ) {
                const candidate =
                    messages[j];

                const candidateText =
                    this.normalizeText(
                        candidate.text
                    );

                if (
                    !candidateText
                ) {
                    continue;
                }

                const textMatches =
                    candidateText ===
                    replyText ||
                    candidateText.includes(
                        replyText
                    ) ||
                    replyText.includes(
                        candidateText
                    ) ||
                    candidateText.startsWith(
                        replyText.replace(
                            /\.\.\.$/,
                            ""
                        )
                    );

                if (textMatches) {
                    current
                        .replyToMessageId =
                        candidate
                            .messageId;

                    break;
                }
            }
        }

        return messages;
    }

    normalizeText(value) {
        return (value || "")
            .replace(
                /…/g,
                "..."
            )
            .replace(
                /\s+/g,
                " "
            )
            .trim()
            .toLowerCase();
    }
}

module.exports =
    WhatsAppWebSource;