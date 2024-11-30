#! /usr/bin/env bun

import { $ } from "bun";
import { watch } from "fs";
import { AIClient } from './ai';
import chalk from "chalk";

const aiClient = new AIClient();

async function main() {
    const args = process.argv.slice(2);
    const folder = args[0] ?? "./example";

    console.log(chalk.blue.bold("\n\nWelcome to Test Driven AI Development!\n"));

    // Just in case, force initialize the folder as a Git repository. 
    // This should be a no-op if it is already a Git repository.
    await $`git init`.cwd(folder);

    let runningTestPromise: Promise<void> | null = null;

    async function stepUntilTestsPass() {
        const gitRef = (await $`git rev-parse HEAD`.cwd(folder).text()).trim();

        console.log(chalk.green("Testing your code..."));
        while (!(await step(folder, gitRef.trim()))) { }
        console.log(chalk.green("All tests passed!"));

        console.log(chalk.green("Squashing commits..."));
        const gitLog = await $`git log -p ${gitRef}..HEAD`.cwd(folder).text();
        if (gitLog.trim() !== "") {
            const commitMsg = await aiClient.getCommitMessage(gitLog);
            await $`git reset --soft ${gitRef} && git commit -m ${commitMsg}`.cwd(folder).nothrow().text();
        }

        console.log(chalk.green("Done!\n\n"));
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
    console.log(chalk.red("Tests failed..."));

    const gitLog = await $`git log -p ${gitRefStart}..HEAD`.cwd(folder).text();

    const response = aiClient.getNewCode(gitLog, testFileText, mainFileText, errors);

    for await (const { name, text } of response) {
        switch (name) {
            case "plan":
                // Render the plan
                console.log(chalk.green("Plan to fix:"));
                console.log(text);
                break;
            case "code":
                console.log(chalk.green("Modifying code..."));
                // Then write the code to the `main.go` file
                let newMainFileText = text;
                newMainFileText = newMainFileText.match(/```go\n([\s\S]*)\n```/)?.[1] ?? newMainFileText;
                await Bun.write(`${folder}/main.go`, newMainFileText);
                break;
            case "commitMessage":
                console.log(chalk.green("Writing commit message..."));
                // Finally create a Git commit
                await $`git add . && git commit --allow-empty -m ${JSON.stringify(text)}`.cwd(folder);
                break;
        }
    }


    return false;
}

main().catch(console.error);