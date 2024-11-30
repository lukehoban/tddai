import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';

export type Section = { name: string, text: string };
export type CompletionSectionsResult = AsyncGenerator<Section>;

export class AIClient {
    private client: Anthropic;
    private model: string;

    constructor() {
        this.client = new Anthropic({
            apiKey: process.env['ANTHROPIC_API_KEY'],
        });
        this.model = 'claude-3-5-sonnet-20241022';
    }

    private async getCompletion(systemMessage: string, messages: string[]): Promise<string> {
        const response = await this.client.messages.create({
            max_tokens: 1024 * 8,
            system: systemMessage,
            messages: messages.map(x => ({ role: "user" as "user", content: x })),
            model: this.model,
            temperature: 0.7,
        });
        if (response.content[0].type !== 'text') {
            throw new Error("Unexpected response type");
        }
        return response.content[0].text;
    }

    private async* getCompletionSections(systemMessage: string, messages: string[]): CompletionSectionsResult {
        const returnedTags = new Set<string>();
        const response = this.client.messages.stream({
            max_tokens: 1024 * 8,
            system: systemMessage,
            messages: messages.map(x => ({ role: "user" as "user", content: x })),
            model: this.model,
            temperature: 0.7,
        });
        let buffer = "";

        for await (const chunk of response) {
            if (chunk.type == 'content_block_delta' && chunk.delta.type == 'text_delta') {
                buffer += chunk.delta.text;
                const tags = getAllXMLBlocks(buffer);
                for (const tag of tags) {
                    if (!returnedTags.has(tag)) {
                        yield { name: tag, text: extractXML(buffer, tag) };
                        returnedTags.add(tag);
                    }
                }
            }
        }
    }

    async getCommitMessage(gitLog: string): Promise<string> {
        const systemPrompt =
            `
You have successfully passed all tests. Please provide a commit message for your changes.

Tips:
- You don't need to reference that this is just to pass the tests, describe the changes *including* the tests as though you wrote both.
- Your commit message should describe what the changes accomplished, not all the details of the code changes themselves.

Your response must always include one section:
- <commitMessage>...</commitMessage>:  The text between the XML markers will be used literally as the Git commit message

Example output:
----
<commitMessage>
Improve object storage concurrency and temp file handling

Fixed race conditions in putIfAbsent by checking file existence before operations and using unique temp file names. Improved list operation to filter out temporary files and added cleanup of stale files during initialization. Also included deterministic random string generation for testing.
</commitMessage>
----
`;

        const response = this.getCompletionSections(
            systemPrompt,
            [`Here is the git log of all the changes you made:\n${gitLog}`],
        );

        for await (const { name, text } of response) {
            if (name != "commitMessage") {
                console.warn("wrong tag!")
            }
            return text;
        }

        throw new Error("invalid output missing commitMessage");
    }

    async* getNewCode(gitLog: string, testFileText: string, mainFileText: string, errors: string): CompletionSectionsResult {
        const systemPrompt =
            `
You are an assistant that implements Go code for a user to comply with the tests that they provide.  
You will be given their \`main_test.go\` file, the most recent \`main.go\` that you provided, as well as any errors or failures that result from \`go test\`, and you will need to write the new code that should be placed in their \`main.go\` file.
You will first describe your plan for fixing the errors.  Describe what could cause the errors and how you should approach fixing them.
Then you will generate code.  You should include light comments in your output.
Finally you will generate a commit message for the code you wrote.

Tips:
- You will be invoked repeatedly until the code you provide passes all tests.
- If the user changes their tests, the process will start again.
- You *must* make changes to the code each time. 
- You should cleanup code as you go.  Remove unused code, simplify implementations where possible, and ensure that the implementation is as minimal as possible to satisfy passing the tests in as clean and generalizable of code as possible.
- You must make a change to the code if there were any errors. 

Your response must always include three sections (in order):

- <plan>...</plan>: A short description of how you are planning to change the code
- <code>...</code>: The Go code that should replace 'main.go'. The text between the XML markers will be used pasted verbatim into a main.go file.
- <commitMessage>...</commitMessage>:  The text between the XML markers will be used literally as the Git commit message

Example output:
----
<plan>
Add a foo method to fix the error about an undefined function.
Remove the bar method that is not being used.
</plan>
<code>
package example

func foo() {
	
}
</code>
<commitMessage>
Updated code to use a \`foo\` function.
</commitMessage>
----
`;

        const prompt =
            `
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
`;

        const response = this.getCompletionSections(
            systemPrompt,
            [prompt],
        );
        for await (const x of response) {
            yield x;
        }
    }
}

function extractXML(text: string, tag: string): string {
    const openTag = "<" + tag + ">";
    const closeTag = "</" + tag + ">";
    const start = text.indexOf(openTag) + openTag.length;
    const end = text.indexOf(closeTag);
    return text.substring(start, end).trimStart();
}

function getAllXMLBlocks(text: string): string[] {
    const tagRE = /<\/([^>]+)>/g;
    return text.matchAll(tagRE).map(([_, tag]) => tag).toArray();
}