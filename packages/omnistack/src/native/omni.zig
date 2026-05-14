const std = @import("std");

// Une fonction simple exportée pour FFI
pub export fn add(a: i32, b: i32) i32 {
    return a + b;
}

// Une fonction plus complexe manipulant des pointeurs (C-style strings)
pub export fn upper(input: [*]const u8, len: usize, output: [*]u8) void {
    var i: usize = 0;
    while (i < len) : (i += 1) {
        const char = input[i];
        if (char >= 'a' and char <= 'z') {
            output[i] = char - 32;
        } else {
            output[i] = char;
        }
    }
}

// Simulation d'une tâche lourde pour démontrer les Workers vs FFI
pub export fn heavy_task(iterations: u64) u64 {
    var sum: u64 = 0;
    var i: u64 = 0;
    while (i < iterations) : (i += 1) {
        sum += i;
    }
    return sum;
}
