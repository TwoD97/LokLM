# Computer Science Fundamentals — Study Notes

## Interpreter

An **interpreter** is a program that executes source code directly, statement by
statement, without first producing a standalone machine-code file. It reads each
instruction, translates it on the fly, and runs it immediately. Because the
translation happens at run time, interpreters start quickly and make debugging
easier, but they generally run slower than compiled programs.

Examples: CPython, the Ruby MRI interpreter, classic JavaScript engines.

## Compiler

A **compiler** translates an entire source program into machine code (or an
intermediate bytecode) _ahead of time_, producing an executable artifact. The
translation cost is paid once, at build time; the resulting program then runs
directly on the CPU and is typically much faster than interpreted code. The
trade-off is a slower edit–build–run cycle and platform-specific output.

Examples: GCC and Clang for C/C++, the Rust compiler, the Go compiler.

## Interpreter vs. Compiler

| Aspect           | Interpreter         | Compiler             |
| ---------------- | ------------------- | -------------------- |
| Translation time | At run time         | Ahead of time        |
| Startup          | Fast                | Slower (build first) |
| Execution speed  | Slower              | Faster               |
| Error reporting  | At the failing line | At compile time      |

Many modern systems combine both: a **just-in-time (JIT) compiler** interprets
first, then compiles hot paths to machine code during execution.

## Recursion

**Recursion** is a technique where a function calls itself to solve a smaller
instance of the same problem. A correct recursive function needs a **base case**
that stops the recursion and a **recursive case** that moves toward it. Each call
adds a frame to the call stack, so unbounded recursion overflows the stack.
