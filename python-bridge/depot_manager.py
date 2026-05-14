import sys
import subprocess
import os
import json

def get_depot_tools_path():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_dir, "vendor", "depot_tools")

def run_command(cmd_name, args):
    depot_tools = get_depot_tools_path()
    env = os.environ.copy()
    env["PATH"] = f"{depot_tools}:{env.get('PATH', '')}"
    
    cmd = [cmd_name] + args
    try:
        # Use shell=True if needed for some depot_tools on Windows, but on Linux shell=False is better
        result = subprocess.run(cmd, env=env, check=True, capture_output=True, text=True)
        return {"status": "success", "stdout": result.stdout}
    except subprocess.CalledProcessError as e:
        return {"status": "error", "stderr": e.stderr, "code": e.returncode, "stdout": e.stdout}

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No command provided"}))
        sys.exit(1)
        
    command = sys.argv[1]
    args = sys.argv[2:]
    
    if command in ["gclient", "fetch", "git"]:
        print(json.dumps(run_command(command, args)))
    else:
        print(json.dumps({"error": f"Unknown command: {command}"}))

if __name__ == "__main__":
    main()
