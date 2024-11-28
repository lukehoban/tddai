import OpenAI from 'openai';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';

const openAIClient = new OpenAI({
    apiKey: process.env['OPENAI_API_KEY'],
});

const anthropicClient = new Anthropic({
    apiKey: process.env['ANTHROPIC_API_KEY'],
});

async function getCompletion<T>(client: Anthropic | OpenAI, systemMessage: string, messages: { role: "user" | "assistant", content: string }[], model: string, responseSchema?: z.ZodObject<any>): Promise<T> {
    let responseText: string | null;
    if (client instanceof Anthropic) {
        const response = await client.messages.create({
            max_tokens: 1024 * 8,
            system: systemMessage,
            messages: [...messages, ...(responseSchema ? [{ role: 'assistant' as 'assistant', content: "{" }] : [])],
            model,
        });

        if (response.content[0].type !== 'text') {
            throw new Error("Unexpected response type");
        }

        responseText = response.content[0].text;
        if (responseSchema) {
            responseText = "{" + responseText;
        }

    } else {
        const response = await client.chat.completions.create({
            messages: [{ role: "system", content: systemMessage }, ...messages],
            model,
        });

        responseText = response.choices[0].message.content;
    }
    if (responseSchema && responseText !== null) {
        try {
            const responseObj = JSON.parse(responseText);
            const parsedResponse = responseSchema.safeParse(responseObj);
            if (!parsedResponse.success) {
                console.log(responseText);
                throw new Error(`Failed to parse response: ${parsedResponse.error}`);
            }
            return parsedResponse.data as T;
        }
        catch (err) {
            console.log(responseText);
            console.log(err);
            throw new Error(`Failed to parse response: ${err}`);
        }
    } else {
        return responseText as T;
    }
}

export async function getCommitMessage(gitLog: string, useAnthropic: boolean = true): Promise<string> {
    const client = useAnthropic ? anthropicClient : openAIClient;
    const model = useAnthropic ? 'claude-3-5-sonnet-20240620' : 'gpt-4o-2024-08-06';

    const response = await getCompletion<{ commit_message: string }>(client,
        "You have successfully passed all tests.  Please provide a commit message for your changes.  You don't need to reference that this is just to pass the tests, describe the changes *including* the tests as though you wrote both.",
        [{
            role: 'user',
            content: `Here is the git log of all the changes you made:\n${gitLog}\n\nYour commit message should describe what the changes accomplished, not all the details of the code changes themselves.`,
        }, {
            role: 'user',
            content: `
                You must always generate a result as a valid JSON object with a format:
                {
                  'commit_message': '<a commit message that describes the changes you made.  Short first line and then 1-2 tight paragraphs of details as needed.'
                }

                Make sure to escape newlines correctly within JSON strings!
            `
        }],
        model,
        z.object({
            commit_message: z.string().describe("A commit message that describes the changes you made.  Short first line and then 1-2 tight paragraphs of details as needed."),
        }),
    );

    return response.commit_message;
}

export async function getNewCode(gitLog: string, testFileText: string, mainFileText: string, errors: string, useAnthropic: boolean = true): Promise<{ plan: string, code: string, commit_message: string }> {
    const client = useAnthropic ? anthropicClient : openAIClient;
    const model = useAnthropic ? 'claude-3-5-sonnet-20240620' : 'gpt-4o-2024-08-06';

    const systemPrompt = `
You are an assistant that implements Go code for a user to comply with the tests that they provide.  
You will be given their \`main_test.go\` file, the most recent \`main.go\` that you provided, as well as any errors or failures that result from \`go test\`, and you will need to write the new code that should be placed in their \`main.go\` file.
You should include light comments in your output.
You will be invoked repeatedly until the code you provide passes all tests.
If the user changes their tests, the process will start again.
You *must* make changes to the code each time. 
You should do light refactoring to "clean up" and "simplify" the code as well as fixing any errors that are present.
`;

    const prompt = `
    Here are the changes that you have made so far since the last time the code passed the tests:
    \`\`\`
    ${gitLog}
    \`\`\`
    Here is the current \`main_test.go\`:
    \`\`\`go
    ${testFileText}
    \`\`\`
    And here is the last \`main.go\` that you provided:
    \`\`\`go
    ${mainFileText}
    \`\`\`
    Here are the errors or failures that resulted from \`go test\`:
    \`\`\`
    ${errors}
    \`\`\`
    Please write the new code that should be placed in the \`main.go\` file.  
    You must make a change to the code if there were any errors. 
    `;

    const responseSchema = z.object({
        plan: z.string().describe("A short description of how you are planning to change the code."),
        code: z.string().describe("The Go code that should replace `main.go`."),
        commit_message: z.string().describe("A short commit message that describes the changes you made."),
    });

    const response = await getCompletion<z.infer<typeof responseSchema>>(client,
        systemPrompt,
        [
            { role: 'user', content: prompt },
            {
                role: 'user', content: `
                You must always generate a result as a valid JSON object with a format:
                {
                  'plan': '<a short description of how you are planning to change the code>', 
                  'code': '<the Go code that should replace 'main.go'>', 
                  'commit_message': '<a short commit message that describes the changes you made>'
                }
                Make sure to escape all characters within string literals inside JSON!
                `
            },
        ],
        model,
        responseSchema,
    );

    return response;
}
