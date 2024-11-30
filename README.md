# Test-Driven AI Development

An AI agent that writes code to implement requirements specified by unit tests.

Tests are a great way to define the requirements for a piece of software significantly more tightly than just native languge prose, so this can be used to create precisely defined behaviour for a codebase.

Users simply edit their tests, and when the tests change, the AI updates the implementation to correctly implement what the tests expect.  

Other tools generate tests autoamtically, but `tddai` generates implementaiton automatically.

> Note: Currently supports only Go code. In the future other languages will be added.

### Example

https://github.com/user-attachments/assets/bf797911-2cc8-4045-81a5-015cff130db8

```
Welcome to Test Driven AI Development!

Reinitialized existing Git repository in /Users/lukehoban/dd/tddai/example/.git/
Testing your code...
testing: warning: no tests to run
PASS
ok      example 0.193s
All tests passed!
Squashing commits...
Done!


Tests have changed.  Restarting.
Testing your code...
go: finding module for package gotest.tools/assert
go: found gotest.tools/assert in gotest.tools v2.2.0+incompatible
go: finding module for package github.com/google/go-cmp/cmp
go: finding module for package github.com/pkg/errors
go: found github.com/google/go-cmp/cmp in github.com/google/go-cmp v0.6.0
go: found github.com/pkg/errors in github.com/pkg/errors v0.9.1
# example [example.test]
./main_test.go:10:9: undefined: Parse
./main_test.go:11:18: undefined: Add
./main_test.go:11:22: undefined: Val
FAIL    example [build failed]
Tests failed...
Plan to fix:
The test is checking for a `Parse` function that takes a string input and returns a structure that represents an addition operation. Based on the test case:
1. We need to create types `Add` and `Val` to represent the arithmetic expression
2. Implement the `Parse` function that converts a string like "ADD 1 2" into the corresponding structure
3. The function should split the input string and convert the numbers to integers

Modifying code...
Writing commit message...
[main 984f21a] "Initial implementation of Parse function with Add and Val types\n"
 4 files changed, 47 insertions(+)
# example [example.test]
./main.go:19:12: undefined: fmt
FAIL    example [build failed]
Tests failed...
Plan to fix:
The build failure is due to a missing import of the "fmt" package which is used in the Parse function with fmt.Sscanf. I'll add the necessary import statement to fix this build error.

Modifying code...
Writing commit message...
[main 7bd5284] "Added missing fmt import for Sscanf usage\n"
 1 file changed, 2 insertions(+)
PASS
ok      example 0.199s
All tests passed!
Squashing commits...
Done!
```


### Building and Running

Create a folder with a `main.go`, `main_test.go` and `go.mod`.  

Then run `bun run index.ts <folder>` to start!


