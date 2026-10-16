import modal

stub = modal.Stub("aetheros-ai")
image = modal.Image.debian_slim().pip_install(
    "torch", "transformers", "peft", "datasets", "accelerate", "bitsandbytes"
)

@stub.function(image=image, gpu="T4", timeout=600)
def train_lora(dataset_content: str, base_model: str = "microsoft/Phi-3-mini-4k-instruct"):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments, Trainer
    from datasets import Dataset
    from peft import LoraConfig, get_peft_model
    import tempfile
    import os

    # Parse dataset jsonl/csv/txt
    lines = [line.strip() for line in dataset_content.splitlines() if line.strip()]
    dataset = Dataset.from_dict({"text": lines})

    tokenizer = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)
    tokenizer.pad_token = tokenizer.eos_token

    def tokenize_function(examples):
        return tokenizer(examples["text"], padding="max_length", truncation=True, max_length=512)

    tokenized_dataset = dataset.map(tokenize_function, batched=True)

    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        torch_dtype=torch.float16,
        device_map="auto",
        trust_remote_code=True
    )

    peft_config = LoraConfig(
        r=16,
        lora_alpha=32,
        target_modules=["q_proj", "v_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM"
    )

    model = get_peft_model(model, peft_config)

    training_args = TrainingArguments(
        output_dir="/tmp/results",
        num_train_epochs=3,
        per_device_train_batch_size=2,
        save_strategy="no",
        logging_steps=10,
        learning_rate=2e-4,
        fp16=True,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized_dataset,
    )

    trainer.train()

    output_dir = "/tmp/adapter"
    model.save_pretrained(output_dir)

    # Return serialized files or confirmation
    return {"status": "success", "message": "Training complete on Modal GPU T4"}
