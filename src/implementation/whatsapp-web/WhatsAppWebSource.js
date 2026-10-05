const { chromium } = require("playwright");

const MessageSource =
    require("../../domain/interfaces/MessageSource");

const MAX_HISTORY_SCROLLS = 10;

class WhatsAppWebSource extends MessageSource {
    constructor() {
        super();

        this.context = null;
        this.page = null;
        this.currentChat = null;
        this.unresolvedAttempted = new Set();
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

    /*
     * WhatsApp only keeps the messages near the viewport in the DOM.
     * A reply whose parent was scrolled out of view would otherwise be
     * saved as a thread of its own, so when we see replies we cannot
     * link, scroll up to load older messages and parse again.
     */
    async getRawMessages() {
        let messages =
            await this.parseRenderedMessages();

        const unresolved = list =>
            list.filter(
                message =>
                    !message.replyToMessageId &&
                    (
                        message.replyContext?.text ||
                        message.replyContext?.hasImage ||
                        message.replyContext?.hasVideo
                    ) &&
                    !this.unresolvedAttempted.has(
                        message.messageId
                    )
            );

        const pending =
            unresolved(messages);

        if (pending.length === 0) {
            return messages;
        }

        // Only try once per message so we don't rescroll every poll.
        pending.forEach(message =>
            this.unresolvedAttempted.add(
                message.messageId
            )
        );

        console.log(
            `${pending.length} reply(ies) have no visible parent. Loading older messages...`
        );

        try {
            for (
                let attempt = 0;
                attempt < MAX_HISTORY_SCROLLS;
                attempt++
            ) {
                const grew =
                    await this.scrollChatUp();

                messages =
                    await this.parseRenderedMessages();

                const stillUnresolved =
                    messages.filter(
                        message =>
                            pending.some(
                                p =>
                                    p.messageId ===
                                    message.messageId
                            ) &&
                            !message.replyToMessageId
                    );

                if (
                    stillUnresolved.length === 0 ||
                    !grew
                ) {
                    break;
                }
            }
        } finally {
            await this.scrollChatToBottom();
        }

        return messages;
    }

    async scrollChatUp() {
        const before =
            await this.page
                .locator("#main .focusable-list-item")
                .count();

        await this.page.evaluate(() => {
            const first =
                document.querySelector(
                    "#main .focusable-list-item"
                );

            let node = first?.parentElement;

            while (node) {
                if (
                    node.scrollHeight >
                    node.clientHeight &&
                    getComputedStyle(node)
                        .overflowY !== "visible"
                ) {
                    node.scrollTop = 0;
                    return;
                }

                node = node.parentElement;
            }
        });

        await this.page.waitForTimeout(1500);

        const after =
            await this.page
                .locator("#main .focusable-list-item")
                .count();

        return after > before;
    }

    async scrollChatToBottom() {
        await this.page.evaluate(() => {
            const last = Array.from(
                document.querySelectorAll(
                    "#main .focusable-list-item"
                )
            ).pop();

            let node = last?.parentElement;

            while (node) {
                if (
                    node.scrollHeight >
                    node.clientHeight &&
                    getComputedStyle(node)
                        .overflowY !== "visible"
                ) {
                    node.scrollTop =
                        node.scrollHeight;
                    return;
                }

                node = node.parentElement;
            }
        });

        await this.page.waitForTimeout(500);
    }

    async parseRenderedMessages() {
        const main = this.page.locator("#main");

        await this.page.waitForTimeout(1000);

        const items =
            main.locator(".focusable-list-item");

        const count =
            await items.count();

        console.log(
            `Found ${count} rendered items`
        );

        const messages = [];

        for (let i = 0; i < count; i++) {
            try {
                const item =
                    items.nth(i);

                const messageId =
                    await item.evaluate(
                        element => {
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
                    item
                        .locator(
                            "[data-pre-plain-text]"
                        )
                        .first();

                let metadata = null;

                if (
                    await metadataLocator.count() > 0
                ) {
                    metadata =
                        await metadataLocator.getAttribute(
                            "data-pre-plain-text"
                        );
                }

                const parsed =
                    metadata
                        ? this.parseMetadata(
                            metadata
                        )
                        : {
                            sender: null,
                            date: null,
                            time: null
                        };

                let text =
                    await this.extractText(
                        item
                    );

                const attachments =
                    await this.extractAttachments(
                        item,
                        messageId
                    );

                if (
                    !text &&
                    attachments.length > 0
                ) {
                    text =
                        this.getAttachmentPlaceholder(
                            attachments[0]
                        );
                }

                const replyContext =
                    await this.extractReplyContext(
                        item
                    );

                // Ignore WhatsApp DOM items that contain no actual message content
                const hasText =
                    Boolean(text && text.trim());

                const hasAttachments =
                    attachments.length > 0;

                const hasReplyContext =
                    Boolean(
                        replyContext?.text ||
                        replyContext?.hasImage ||
                        replyContext?.hasVideo
                    );

                if (
                    !hasText &&
                    !hasAttachments &&
                    !hasReplyContext
                ) {
                    console.log(
                        `Skipping empty WhatsApp item ${messageId}`
                    );

                    continue;
                }

                console.log(
                    messageId,
                    JSON.stringify(text),
                    attachments.map(
                        attachment =>
                            attachment.type
                    )
                );

                messages.push({
                    messageId,

                    sender:
                        parsed.sender,

                    timestamp:
                        parsed.date &&
                            parsed.time
                            ? `${parsed.date} ${parsed.time}`
                            : null,

                    text:
                        text || "",

                    attachments,

                    replyContext,

                    replyToMessageId:
                        null
                });

            } catch (error) {
                console.warn(
                    `Skipping rendered item ${i}:`,
                    error.message
                );
            }
        }

        const resolved =
            this.resolveReplyLinks(
                messages
            );

        console.log(
            `Parsed ${resolved.length} messages`
        );

        return resolved;
    }

    async extractText(item) {
        return item.evaluate(
            element => {
                const clone =
                    element.cloneNode(true);

                /*
                 * Remove quoted/replied-to content.
                 *
                 * Otherwise the quoted parent text
                 * gets mixed into the child's text.
                 */
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

                /*
                 * Avoid nested duplicate text nodes.
                 */
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

        /*
         * =========================================
         * IMAGE
         * =========================================
         *
         * For the current MVP, images remain stored
         * as Base64.
         *
         * Later we should move images to S3 as well.
         */
        const imageThumb =
            item.locator(
                '[data-testid="image-thumb"]'
            );

        if (
            await imageThumb.count() >
            0
        ) {
            try {
                const image =
                    imageThumb
                        .locator("img")
                        .last();

                if (
                    await image.count() >
                    0
                ) {
                    const result =
                        await image.evaluate(
                            async img => {
                                if (
                                    !img.src
                                ) {
                                    return null;
                                }

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
                                    i <
                                    bytes.length;
                                    i++
                                ) {
                                    binary +=
                                        String.fromCharCode(
                                            bytes[
                                            i
                                            ]
                                        );
                                }

                                return {
                                    mimeType:
                                        blob.type ||
                                        "image/jpeg",

                                    base64:
                                        btoa(
                                            binary
                                        )
                                };
                            }
                        );

                    if (result) {
                        attachments.push({
                            type:
                                "image",

                            mediaId:
                                messageId,

                            mimeType:
                                result.mimeType,

                            fileName:
                                `${messageId}.jpg`,

                            storageStatus:
                                "inline",

                            base64:
                                result.base64,

                            url:
                                null
                        });
                    }
                }
            } catch (error) {
                console.error(
                    `Image extraction failed for ${messageId}:`,
                    error.message
                );
            }
        }

        /*
         * =========================================
         * VIDEO
         * =========================================
         *
         * Do NOT download video content.
         * Do NOT convert video to Base64.
         *
         * We only persist lightweight metadata.
         */
        const videoLocator =
            item.locator(
                "video"
            );

        const hasVideoElement =
            await videoLocator.count() >
            0;

        const hasVideoIcon =
            await item
                .locator(
                    '[data-icon="video"]'
                )
                .count() >
            0;

        const hasVideoTestId =
            await item
                .locator(
                    '[data-testid*="video"]'
                )
                .count() >
            0;

        if (
            hasVideoElement ||
            hasVideoIcon ||
            hasVideoTestId
        ) {
            attachments.push({
                type:
                    "video",

                mediaId:
                    messageId,

                mimeType:
                    "video/mp4",

                fileName:
                    `${messageId}.mp4`,

                storageStatus:
                    "not_stored",

                base64:
                    null,

                url:
                    null
            });
        }

        return attachments;
    }

    getAttachmentPlaceholder(
        attachment
    ) {
        if (!attachment) {
            return "[Attachment]";
        }

        switch (
        attachment.type
        ) {
            case "image":
                return "[Image]";

            case "video":
                return `[Video: ${attachment.mediaId}]`;

            case "audio":
                return `[Audio: ${attachment.mediaId}]`;

            case "document":
                return `[Document: ${attachment.mediaId}]`;

            default:
                return `[Attachment: ${attachment.mediaId ||
                    "unknown"
                    }]`;
        }
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
            element => {
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

                /*
                 * WhatsApp quoted media can have
                 * multiple DOM representations.
                 */
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

                const hasVideo =
                    !!quoted.querySelector(
                        "video"
                    ) ||
                    !!quoted.querySelector(
                        '[data-icon="video"]'
                    ) ||
                    !!quoted.querySelector(
                        '[data-testid*="video"]'
                    );

                return {
                    sender:
                        author
                            ?.innerText
                            ?.trim() ||
                        null,

                    text,

                    hasImage,
                    hasVideo
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

            const quotedMediaType =
                this.getQuotedMediaType(
                    current.replyContext,
                    replyText
                );

            /*
             * Media quote/reply.
             */
            if (quotedMediaType) {
                for (
                    let j = i - 1;
                    j >= 0;
                    j--
                ) {
                    const candidate =
                        messages[j];

                    const matchingAttachment =
                        candidate
                            .attachments
                            ?.find(
                                attachment =>
                                    attachment.type ===
                                    quotedMediaType
                            );

                    if (
                        !matchingAttachment
                    ) {
                        continue;
                    }

                    current.replyToMessageId =
                        candidate.messageId;

                    /*
                     * Media-only messages sometimes
                     * have no normal sender metadata.
                     *
                     * The reply quote gives us the
                     * original author's name.
                     */
                    if (
                        !candidate.sender &&
                        current
                            .replyContext
                            ?.sender
                    ) {
                        candidate.sender =
                            current
                                .replyContext
                                .sender;
                    }

                    break;
                }

                continue;
            }

            if (!replyText) {
                continue;
            }

            /*
             * Standard text reply matching.
             */
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

                if (!candidateText) {
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
                    current.replyToMessageId =
                        candidate.messageId;

                    break;
                }
            }
        }

        return messages;
    }

    getQuotedMediaType(
        replyContext,
        replyText
    ) {
        if (
            replyContext
                ?.hasVideo ||
            [
                "video",
                "[video]"
            ].includes(
                replyText
            )
        ) {
            return "video";
        }

        if (
            replyContext
                ?.hasImage ||
            [
                "photo",
                "image",
                "[image]"
            ].includes(
                replyText
            )
        ) {
            return "image";
        }

        return null;
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

    async isAlive() {
        try {
            return Boolean(
                this.context &&
                this.page &&
                !this.page.isClosed()
            );
        } catch {
            return false;
        }
    }

    async reconnect() {
        console.log(
            "Reconnecting WhatsApp browser..."
        );

        const chatName =
            this.currentChat ||
            "SuperProcure Control Room";

        try {
            if (this.context) {
                await this.context.close();
            }
        } catch (_) {
            // Browser/context may already be gone.
        }

        this.context = null;
        this.page = null;

        await this.initialize();

        await this.openChat(
            chatName
        );

        console.log(
            "WhatsApp browser reconnected."
        );
    }
}

module.exports =
    WhatsAppWebSource;