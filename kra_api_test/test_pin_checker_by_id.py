import base64
import json
import urllib.request
import urllib.error

# Sandbox Endpoints
TOKEN_URL = "https://sbx.kra.go.ke/v1/token/generate?grant_type=client_credentials"
PIN_CHECKER_BY_ID_URL = "https://sbx.kra.go.ke/checker/v1/pin"

def get_access_token(consumer_key, consumer_secret):
    """Step 1: Generate Access Token"""
    print("Generating access token...")
    
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

def check_pin_by_id(access_token, taxpayer_type, taxpayer_id):
    """Step 2: Invoke PIN Checker by ID API"""
    print(f"\nInvoking PIN Checker by ID API for Type: {taxpayer_type}, ID: {taxpayer_id}...")
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {access_token}"
    }
    
    body = {
        "TaxpayerType": taxpayer_type,
        "TaxpayerID": taxpayer_id
    }
    
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(PIN_CHECKER_BY_ID_URL, data=data, headers=headers, method="POST")
    
    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode('utf-8'))
            print("✅ PIN Checker by ID API Response:")
            print(json.dumps(result, indent=4))
    except urllib.error.HTTPError as e:
        print(f"❌ Error checking PIN by ID (HTTP {e.code}):")
        print(e.read().decode('utf-8'))
    except Exception as e:
        print(f"❌ Unexpected error checking PIN by ID: {e}")

if __name__ == "__main__":
    # credentials provided
    CONSUMER_KEY = "etOD2RuLREB7RgVBtyb5DbsS1Id3OaIwJIkGKhk0GPPaAhNf"
    CONSUMER_SECRET = "B1O4sVOwJffPUAB7gkM03c38gAfmbzXVnn73MdFp320fR67rphdSnPTIK3HtRovv"
    
    # Step 1: Get the token
    token = get_access_token(CONSUMER_KEY, CONSUMER_SECRET)
    
    if token:
        # Step 2: Test PIN Checker by ID API
        # Using the standard Kenyan resident sample data: KE - 41789723
        # Other sample data: NKE / 787528, NKENR / B3962C4A5718, COMP / 0000200S4304
        check_pin_by_id(
            access_token=token,
            taxpayer_type="KE",
            taxpayer_id="29430821"
        )
