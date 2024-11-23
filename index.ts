#! /usr/bin/env bun

import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { $ } from "bun";
import { watch } from "fs";
import { z } from "zod";

const client = new OpenAI({
    apiKey: process.env['OPENAI_API_KEY'],
});

async function main() {
    const args = process.argv.slice(2);
    const folder = args[0] ?? "./example";

    console.log("Welcome to Test Driven AI Development!\n");

    // Just in case, force initialize the folder as a Git repository. 
    // This should be a no-op if it is already a Git repository.
    await $`git init`.cwd(folder);

    let runningTestPromise: Promise<void> | null = null;

    async function stepUntilTestsPass() {
        const gitRef = (await $`git rev-parse HEAD`.cwd(folder).text()).trim();
        console.log("Testing your code...");
        while (!(await step(folder, gitRef.trim()))) { }
        console.log("All tests passed!");
        console.log("Squashing commits...");
        console.log("Done!\n\n")

        const gitLog = await $`git log -p ${gitRef}..HEAD`.cwd(folder).text();
        
        const commitMsg = await client.beta.chat.completions.parse({
            messages: [
                { role: 'system', content: "You have successfully passed all tests.  Please provide a commit message for your changes.  You don't need to reference that this is just to pass the tests, describe the changes *including* the tests as though you wrote both." },
                { role: 'user', content: `Here is the git log of all the changes you made:\n${gitLog}\n\nYour commit message should describe what the changes accomplished, not all the details of the code changes themselves.` },
            ],
            model: 'gpt-4o-2024-08-06',
            response_format: zodResponseFormat(z.object({
                commit_message: z.string().describe("A commit message that describes the changes you made.  Short first line and then 1-2 paragraphs of details as needed."),
            }), "Response"),
        }).then(r => r.choices[0].message.parsed?.commit_message ?? "Update code");
        
        await $`git reset --soft ${gitRef} && git commit -m ${commitMsg}`.cwd(folder).nothrow().text();
        runningTestPromise = null;
    }

    watch(folder, async (ev, filename) => {
        if (filename === "main_test.go") {
            if (!runningTestPromise) {
                console.log("Tests have changed.  Restarting.");
                runningTestPromise = stepUntilTestsPass();
            }
        }
    });
    
    runningTestPromise = stepUntilTestsPass();
}

async function step(folder: string, gitRefStart: string): Promise<boolean> {
    const mainFileText = await Bun.file(`${folder}/main.go`).text();
    const testFileText = await Bun.file(`${folder}/main_test.go`).text();
    const testCmd = await $`go mod tidy && go test`.cwd(folder).nothrow();
    if (testCmd.exitCode === 0) {
        // Tests are passing - so we are done and return true to stop looping.
        return true;
    }
    const errors = testCmd.text();

    const gitLog = await $`git log -p ${gitRefStart}..HEAD`.cwd(folder).text();

    const systemPrompt = `
    
    You are an assistant that implements Go code for a user to comply with the tests that they provide.  
    
    You will be given their \`main_test.go\` file, the most recent \`main.go\` that you provided, as well as any errors or failures that result from \`go test\`, and you will need to write the new code that should be placed in their \`main.go\` file.

    You should include light comments in your output.

    You will be invoked repeatedly until the code you provide passes all tests.

    If the user changes their tests, the process will start again.

    You *must* make changes to the code each time. 

    You should do light refactoring to "clean up" and "simplify" the code as well as fixing any errors that are present.
    `

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
    `

    const chatCompletion = await client.beta.chat.completions.parse({
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
        ],
        model: 'gpt-4o-2024-08-06',
        response_format: zodResponseFormat(z.object({
            plan: z.string().describe("A short description of how you are planning to change the code."),
            code: z.string().describe("The Go code that should replace \`main.go\`."),
            commit_message: z.string().describe("A short commit message that describes the changes you made."),
        }), "Response"),
    });

    let resp = chatCompletion.choices[0].message.parsed;
    if (!resp) {
        console.error("No completion provided.");
        console.log(JSON.stringify(chatCompletion, null, 2));
        return false;
    }

    // Render the plan
    console.log(resp.plan);

    // Then write the code to the `main.go` file
    let newMainFileText = resp.code;
    newMainFileText = newMainFileText.match(/```go\n([\s\S]*)\n```/)?.[1] ?? newMainFileText;
    await Bun.write(`${folder}/main.go`, newMainFileText);

    // Finally create a Git commit
    const gitCommitCmd = await $`git add . && git commit --allow-empty -m ${JSON.stringify(resp.commit_message)}`.cwd(folder);

    return false;
}

main().catch(console.error);