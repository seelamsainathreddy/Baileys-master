import subprocess
import time
import requests

def check_internet(host="http://www.google.com", timeout=5):
    try:
        requests.get(host, timeout=timeout)
        return True
    except requests.ConnectionError:
        return False

def reconnect_wifi(network_name, interface='en0'):
    try:
        print(f"Reconnecting to {network_name}...")
        # Turn off Wi-Fi
        subprocess.run(['networksetup', '-setairportpower', interface, 'off'], check=True)
        time.sleep(2)  # Wait a moment before reconnecting
        # Turn on Wi-Fi
        subprocess.run(['networksetup', '-setairportpower', interface, 'on'], check=True)
        time.sleep(5)  # Wait for the Wi-Fi to turn back on
        # Connect to the specified network
        subprocess.run(['networksetup', '-setairportnetwork', interface, network_name], check=True)
        print("Reconnected successfully.")
    except subprocess.CalledProcessError as e:
        print(f"Failed to reconnect: {e}")

def main():
    network_name = "YourNetworkName"  # Replace with your network name
    interface = "en0"  # Replace with your Wi-Fi interface

    while True:
        if not check_internet():
            print("No internet connection. Attempting to reconnect...")
            reconnect_wifi(network_name, interface)
        else:
            print("Internet connection is stable.")
        time.sleep(2)  # Check every 60 seconds

if __name__ == "__main__":
    main()
