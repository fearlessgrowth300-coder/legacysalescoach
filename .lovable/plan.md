
# Twilio Practice Calling Integration

## Overview
When you click "Start Call" on a practice scenario, Twilio will call your real phone number. The AI prospect will answer based on the scenario you chose, using your brain's knowledge to coach you. The conversation flows naturally over a real phone call.

## How It Works
1. You select a scenario and enter your phone number
2. Click "Start Call" -- Twilio calls your phone
3. When you pick up, the AI prospect greets you based on the scenario
4. You speak, the AI transcribes via Twilio's speech recognition, generates a response using the existing practice-call AI, and speaks it back using text-to-speech
5. The conversation continues turn-by-turn until you hang up
6. After the call ends, you see your full transcript and coaching analysis in the app

## Setup Required (from you)
You'll need 3 things from your Twilio Console (https://console.twilio.com):
- **Account SID** (found on dashboard)
- **Auth Token** (found on dashboard)
- **Twilio Phone Number** (a number you've purchased that can make outbound calls)

## Technical Plan

### 1. Store Twilio Credentials
Add 3 secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`

### 2. Create Edge Function: `twilio-practice-call`
This function handles two actions:
- **`initiate`**: Called from the app when user clicks "Start Call". Makes an outbound call via Twilio REST API to the user's phone number, pointing the call's webhook URL to the `twilio-practice-webhook` function
- **`status`**: Receives call status updates (ringing, answered, completed) and forwards them to the app

### 3. Create Edge Function: `twilio-practice-webhook`
This is the TwiML webhook that Twilio hits during the call:
- On first request: Plays the AI prospect's opening line using `<Say>` and starts listening with `<Gather input="speech">`
- On each speech input: Sends the transcribed text to the existing `practice-call` AI logic, gets the prospect response, speaks it back with `<Say>`, and loops with another `<Gather>`
- Stores each exchange in a temporary session (in-memory or database) for post-call analysis

### 4. Update Practice Call UI (`PracticeCall.tsx`)
- Add a phone number input field (saved to user profile for convenience)
- Add "Call My Phone" button alongside the existing text-based practice
- Show real-time call status (ringing, connected, in-progress)
- When call ends, display the full transcript with coaching scores (reusing existing analysis UI)

### 5. Database Changes
- Add `phone_number` column to `profiles` table (optional, for saving the user's number)
- Create `practice_call_sessions` table to store call transcripts and scores:
  - `id`, `user_id`, `scenario_id`, `twilio_call_sid`, `transcript` (jsonb), `overall_score`, `status`, `created_at`

### 6. Call Flow Diagram
```text
[App] ---> twilio-practice-call (initiate)
                |
                v
         Twilio REST API ---> Calls user's phone
                |
                v
         User answers ---> Twilio hits twilio-practice-webhook
                |
                v
         AI generates prospect greeting (TwiML <Say>)
                |
                v
         <Gather speech> listens to user
                |
                v
         User speaks ---> Twilio transcribes ---> webhook receives text
                |
                v
         practice-call AI generates response ---> <Say> speaks it back
                |
                v
         Loop until hangup ---> Call ends ---> status callback
                |
                v
         App shows transcript + coaching analysis
```

### Important Notes
- Twilio charges per minute for outbound calls (check your Twilio pricing)
- The webhook URL must be publicly accessible -- the deployed edge function URL works for this
- Speech recognition language defaults to English (configurable)
- Each call turn has a ~2-3 second AI processing delay (similar to talking to a real person thinking)
