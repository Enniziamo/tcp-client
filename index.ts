
import net from "node:net";
import readline from "node:readline";
import Groq from "groq-sdk";

const HOST = "0.0.0.0";
const PORT = 1342;

const MODEL =
    process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";

const API_KEY = process.env.GROQ_API_KEY;

if (!API_KEY) {
    console.error("GROQ_API_KEY is not defined!");
    process.exit(1);
}

const groq = new Groq({
    apiKey: API_KEY
});

const socket = new net.Socket();

let terminalClosed = false;
const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
});

let authenticated = false;
let aiBusy = false;

type ChatMessage = {
    role: "user" | "assistant";
    content: string;
};

const history: ChatMessage[] = [];

const SYSTEM_PROMPT = `
You are a helpful AI assistant integrated into a
TCP chat application.

Answer clearly and accurately.
Use Turkish when the user speaks Turkish.
You can help with programming, technology and general questions.
`;

function sendLine(message: string) {
    if (!socket.destroyed) {
        socket.write(message + "\n");
    }
}

function prompt() {
    if (!aiBusy && !terminalClosed) {
        terminal.setPrompt("> ");
        terminal.prompt();
    }
}

async function askAI(question: string) {
    if (aiBusy) {
        console.log("AI is already processing a request.");
        return;
    }

    if (!question.trim()) {
        console.log("Usage: /ai your question");
        return;
    }

    aiBusy = true;

    console.log("\n[Groq AI] Thinking...\n");

    history.push({
        role: "user",
        content: question
    });

    try {
        const completion = await groq.chat.completions.create({
            model: MODEL,

            messages: [
                {
                    role: "system",
                    content: SYSTEM_PROMPT
                },
                ...history
            ],

            temperature: 0.7,
            max_completion_tokens: 2048
        });

        const answer =
            completion.choices[0]?.message?.content;

        if (!answer) {
            console.log("[Groq AI] Empty response.");
            history.pop();
            return;
        }

        history.push({
            role: "assistant",
            content: answer
        });

        // Keep the latest 20 messages.
        if (history.length > 20) {
            history.splice(0, history.length - 20);
        }

        console.log("\n========== GROQ AI ==========\n");
        console.log(answer);
        console.log("\n=============================\n");

    } catch (error) {
        history.pop();

        console.error(
            "[Groq AI Error]",
            error instanceof Error ? error.message : error
        );

    } finally {
        aiBusy = false;
        prompt();
    }
}

function showAIHelp() {
    console.log(`
========== AI COMMANDS ==========

/ai QUESTION
    Ask Groq AI a question.

/ai-clear
    Clear AI conversation history.

/ai-help
    Show AI commands.

/online
    Show online users.

/msg USER MESSAGE
    Send a private message.

/exit
    Disconnect from server.

=================================
`);
}

socket.connect(PORT, HOST, () => {
    console.log(`Connected to ${HOST}:${PORT}`);
});

socket.on("data", (data: Buffer) => {
    const received = data.toString();

    process.stdout.write("\n" + received);

    if (
        received.includes("Login successful.") ||
        received.includes("Registered successfully.")
    ) {
        authenticated = true;

        console.log("\nChat and Groq AI are ready!");
        console.log("Type /ai-help to see AI commands.");

        prompt();
    }
});

terminal.on("line", async (line: string) => {
    const message = line.trim();

    if (!message) {
        prompt();
        return;
    }

    // Authentication phase:
    // Forward username, password and menu choice to Rust.
    if (!authenticated) {
        sendLine(message);
        return;
    }

    // AI commands
    if (message.startsWith("/ai ")) {
        const question = message.substring(4).trim();

        await askAI(question);
        return;
    }

    if (message === "/ai-clear") {
        history.length = 0;

        console.log("\n[Groq AI] Conversation history cleared.\n");

        prompt();
        return;
    }

    if (message === "/ai-help") {
        showAIHelp();
        prompt();
        return;
    }

    // Exit
    if (message === "/exit") {
        sendLine("/exit");
        socket.end();
        return;
    }

    // Normal chat commands and messages
    sendLine(message);
});

socket.on("close", () => {
    console.log("\nDisconnected from server.");

    terminal.close();
    process.exit(0);
});

socket.on("error", (error) => {
    console.error("\nConnection error:", error.message);
    terminal.close();
});

process.on("SIGINT", () => {
    console.log("\nDisconnecting...");

    socket.end();
    terminal.close();
});
