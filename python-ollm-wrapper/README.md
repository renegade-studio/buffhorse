# OLLM Python Wrapper

This service wraps the `ollm` Python library and exposes an OpenAI-compatible API, allowing it to be used as a provider in the Codebuff application.

## Setup

1.  **Install Dependencies:**
    Navigate to this directory and install the required Python packages using pip:
    ```bash
    pip install -r requirements.txt
    ```

2.  **Run the Service:**
    Start the FastAPI server using uvicorn:
    ```bash
    uvicorn main:app --host 0.0.0.0 --port 8001
    ```

## API Endpoint

The service exposes the following OpenAI-compatible endpoint:

-   `POST /v1/chat/completions`: This endpoint accepts a standard OpenAI chat completion request and returns a response from the `ollm` library. It supports both streaming and non-streaming responses.

## Environment Variable

To use this service with the Codebuff application, you must set the `OLLM_API_URL` environment variable in your `.env` file:

```
OLLM_API_URL=http://localhost:8001/v1
```