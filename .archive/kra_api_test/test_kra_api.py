import base64
import json
import urllib.request
import urllib.error

# Sandbox Endpoints
TOKEN_URL = "https://sbx.kra.go.ke/v1/token/generate?grant_type=client_credentials"
TOT_URL = "https://sbx.kra.go.ke/filing/v1/tot/paymentregistration"

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

def file_tot_return(access_token, pin, month, year, turnover):
    """Step 2: Invoke TOT Return Filing API"""
    print("\nInvoking TOT Return Filing API...")
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {access_token}"
    }
    
    body = {
        "TAXPAYERDETAILS": {
            "TaxpayerPIN": pin,
            "Month": month,
            "Year": year,
            "GrossTurnover": turnover
        }
    }
    
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(TOT_URL, data=data, headers=headers, method="POST")
    
    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode('utf-8'))
            print("✅ TOT Return Filing API Response:")
            print(json.dumps(result, indent=4))
    except urllib.error.HTTPError as e:
        print(f"❌ Error filing TOT return (HTTP {e.code}):")
        print(e.read().decode('utf-8'))
    except Exception as e:
        print(f"❌ Unexpected error filing TOT return: {e}")

if __name__ == "__main__":
    # --- FILL THESE IN WITH YOUR SANDBOX CREDENTIALS ---
    CONSUMER_KEY = "ZvGPMSIUHOe4OMqjo9AcR0XLMJ89fbgRRK2B9XrpCaBhQg4h"
    CONSUMER_SECRET = "qTGU6GlKKol1Y56Jm0BQx9ZZ613CnsDlwL8h9zARsNfv1N7xZ0whbA7bDUCP4J30"
    
    if CONSUMER_KEY == "your_consumer_key_here":
        print("⚠️ Please update CONSUMER_KEY and CONSUMER_SECRET in the script before running.")
    else:
        # Step 1: Get the token
        token = get_access_token(CONSUMER_KEY, CONSUMER_SECRET)
        
        if token:
            # Step 2: Test TOT return filling 
            # Using the sample data provided in the KRA documentation
            file_tot_return(
                access_token=token,
                pin="A521040203F",
                month="09",
                year="2025",
                turnover=190000
            )