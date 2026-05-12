import base64
import json
import urllib.request
import urllib.error

# Sandbox Endpoints
TOKEN_URL = "https://sbx.kra.go.ke/v1/token/generate?grant_type=client_credentials"
PIN_CHECKER_URL = "https://sbx.kra.go.ke/checker/v1/pinbypin"

def get_access_token(consumer_key, consumer_secret):
    """Step 1: Generate Access Token"""
    print("Generating access token...")
    
    # Base64 encode the Consumer Key and Secret
    credentials = f"{consumer_key}:{consumer_secret}"
    encoded_credentials = base64.b64encode(credentials.encode('utf-8')).decode('utf-8')
    
    headers = {
        "Authorization": f"Basic {encoded_credentials}"
    }
    
    req = urllib.request.Request(TOKEN_URL, headers=headers, method="GET")
    
    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode('utf-8'))
            print("✅ Token generated successfully!")
            return result.get("access_token")
    except urllib.error.HTTPError as e:
        print(f"❌ Error generating token (HTTP {e.code}):")
        print(e.read().decode('utf-8'))
        return None
    except Exception as e:
        print(f"❌ Unexpected error generating token: {e}")
        return None

def check_pin(access_token, pin):
    """Step 2: Invoke PIN Checker API"""
    print(f"\nInvoking PIN Checker API for PIN: {pin}...")
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {access_token}"
    }
    
    body = {
        "KRAPIN": pin
    }
    
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(PIN_CHECKER_URL, data=data, headers=headers, method="POST")
    
    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode('utf-8'))
            print("✅ PIN Checker API Response:")
            print(json.dumps(result, indent=4))
    except urllib.error.HTTPError as e:
        print(f"❌ Error checking PIN (HTTP {e.code}):")
        print(e.read().decode('utf-8'))
    except Exception as e:
        print(f"❌ Unexpected error checking PIN: {e}")

if __name__ == "__main__":
    # credentials provided
    CONSUMER_KEY = "etOD2RuLREB7RgVBtyb5DbsS1Id3OaIwJIkGKhk0GPPaAhNf"
    CONSUMER_SECRET = "B1O4sVOwJffPUAB7gkM03c38gAfmbzXVnn73MdFp320fR67rphdSnPTIK3HtRovv"
    
    # Step 1: Get the token
    token = get_access_token(CONSUMER_KEY, CONSUMER_SECRET)
    
    if token:
        # Step 2: Test PIN Checker API
        # Testing with one of the provided sample test PINs: P318295670X
        # Other test data: A744610021G, A521040203F
        check_pin(
            access_token=token,
            pin="A521040203F"
        )
