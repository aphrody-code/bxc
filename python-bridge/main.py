import sys
import os

def hello():
    return f"Hello from Python! (PID: {os.getpid()})"

def get_env():
    return dict(os.environ)

if __name__ == "__main__":
    print(hello())
