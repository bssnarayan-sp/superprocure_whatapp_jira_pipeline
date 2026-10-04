class GroqThreadClassifier {
  constructor() {
    this.apiKey = process.env.GROQ_API_KEY;
    this.model =
      process.env.GROQ_MODEL ||
      "llama-3.3-70b-versatile";
  }

  async classify(thread) {
    const prompt = `
Analyze this WhatsApp support conversation.

Return ONLY valid JSON:

{
  "classification": "bug|incident|support_query|operational_request|noise",
  "summary": "",
  "description": "",
  "customer": "",
  "module": "",
  "severity": "Critical|High|Medium|Low",
  "referenceIds": []
}

Do not invent information.

Conversation:
${thread.text}
`;

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: prompt
            }
          ]
        })
      }
    );

    if (!response.ok) {
      throw new Error(
        `Groq failed: ${response.status} ${await response.text()}`
      );
    }

    const data = await response.json();

    let content =
      data.choices[0].message.content.trim();

    content = content
      .replace(/^```json/i, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim();

    return JSON.parse(content);
  }
}

module.exports = GroqThreadClassifier;