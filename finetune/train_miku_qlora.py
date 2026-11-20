"""
QLoRA Weight Fine-Tuning Script for Miku Human Companion (Qwen 2.5 3B / 1.5B -> Ollama GGUF)
--------------------------------------------------------------------------------------------
Trains genuine LoRA neural adapters on `miku_human_dataset.jsonl` so Qwen internalizes
natural human cadence + instant 3D motion tags (`[empathy]`, `[laugh]`, `[shrug]`, etc.)
and exports directly to a quantized `Q4_K_M.gguf` ready for `ollama create`!

Usage (Colab T4 GPU or local GPU with `pip install unsloth trl datasets`):
    python finetune/train_miku_qlora.py
"""

from pathlib import Path

DATASET_PATH = Path(__file__).resolve().parent / "miku_human_dataset.jsonl"
BASE_MODEL = "unsloth/Qwen2.5-3B-Instruct-bnb-4bit"
OUTPUT_DIR = Path(__file__).resolve().parent / "miku_qwen25_lora_out"


def train_and_export_gguf():
    from datasets import load_dataset
    from transformers import TrainingArguments
    from trl import SFTTrainer
    from unsloth import FastLanguageModel

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=BASE_MODEL,
        max_seq_length=1024,
        load_in_4bit=True,
    )

    model = FastLanguageModel.get_peft_model(
        model,
        r=16,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_alpha=16,
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
    )

    dataset = load_dataset("json", data_files=str(DATASET_PATH), split="train")

    def format_chatml(batch):
        texts = [
            tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
            for msgs in batch["messages"]
        ]
        return {"text": texts}

    dataset = dataset.map(format_chatml, batched=True)

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=1024,
        args=TrainingArguments(
            per_device_train_batch_size=2,
            gradient_accumulation_steps=4,
            warmup_steps=5,
            max_steps=60,
            learning_rate=2e-4,
            fp16=True,
            logging_steps=5,
            output_dir=str(OUTPUT_DIR),
            optim="adamw_8bit",
        ),
    )

    trainer.train()
    print("Exporting Q4_K_M GGUF for Ollama...")
    model.save_pretrained_gguf(str(OUTPUT_DIR / "gguf"), tokenizer, quantization_method="q4_k_m")
    print("Done! Load into Ollama via: ollama create miku-finetuned -f Modelfile")


if __name__ == "__main__":
    train_and_export_gguf()
