from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Union
import ollm
import json
import time

app = FastAPI()

class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[Dict[str, str]]
    stream: bool = False

@app.post("/v1/chat/completions")
async def create_chat_completion(request: ChatCompletionRequest):
    try:
        # OLLM expects a list of strings, so we need to format the messages
        conversation = [f"{message['role']}: {message['content']}" for message in request.messages]

        response_generator = ollm.generate(
            model_name=request.model,
            prompt=conversation,
            stream=request.stream
        )

        if request.stream:
            async def stream_response():
                for chunk in response_generator:
                    response_chunk = {
                        "id": f"chatcmpl-{''.join(str(time.time()).split('.'))}",
                        "object": "chat.completion.chunk",
                        "created": int(time.time()),
                        "model": request.model,
                        "choices": [
                            {
                                "index": 0,
                                "delta": {"content": chunk},
                                "finish_reason": None,
                            }
                        ],
                    }
                    yield f"data: {json.dumps(response_chunk)}\n\n"

                # Send the final chunk with finish_reason
                final_chunk = {
                    "id": f"chatcmpl-{''.join(str(time.time()).split('.'))}",
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": request.model,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {},
                            "finish_reason": "stop",
                        }
                    ],
                }
                yield f"data: {json.dumps(final_chunk)}\n\n"
                yield "data: [DONE]\n\n"
            return StreamingResponse(stream_response(), media_type="text/event-stream")
        else:
            full_response = "".join(response_generator)
            return {
                "id": f"chatcmpl-{''.join(str(time.time()).split('.'))}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": request.model,
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": full_response,
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 0, # OLLM doesn't provide token counts
                    "completion_tokens": 0,
                    "total_tokens": 0,
                },
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)