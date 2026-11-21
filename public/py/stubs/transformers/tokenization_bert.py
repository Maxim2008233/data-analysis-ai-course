# -*- coding: utf-8 -*-
"""Настоящий токенизатор BERT (WordPiece) на чистом Python — тот же алгоритм, что в transformers.

Шаги: очистка текста → нижний регистр и удаление диакритики → разбиение по пробелам и знакам препинания →
WordPiece: каждое слово жадно делится на самые длинные куски из словаря («hugging» + «##face»).
Результат совпадает с AutoTokenizer.from_pretrained(...) настоящей библиотеки (проверено на сотнях текстов).
"""
import unicodedata

from . import _hub

SPECIAL = {"unk": "[UNK]", "sep": "[SEP]", "pad": "[PAD]", "cls": "[CLS]", "mask": "[MASK]"}


def _is_whitespace(ch):
    if ch in (" ", "\t", "\n", "\r"):
        return True
    return unicodedata.category(ch) == "Zs"


def _is_control(ch):
    if ch in ("\t", "\n", "\r"):
        return False
    return unicodedata.category(ch).startswith("C")


def _is_punctuation(ch):
    cp = ord(ch)
    if 33 <= cp <= 47 or 58 <= cp <= 64 or 91 <= cp <= 96 or 123 <= cp <= 126:
        return True
    return unicodedata.category(ch).startswith("P")


def _is_chinese_char(cp):
    return (
        0x4E00 <= cp <= 0x9FFF or 0x3400 <= cp <= 0x4DBF or 0x20000 <= cp <= 0x2A6DF or 0x2A700 <= cp <= 0x2B73F
        or 0x2B740 <= cp <= 0x2B81F or 0x2B820 <= cp <= 0x2CEAF or 0xF900 <= cp <= 0xFAFF or 0x2F800 <= cp <= 0x2FA1F
    )


def _whitespace_split(text):
    text = text.strip()
    return text.split() if text else []


class BatchEncoding(dict):
    """Словарь с input_ids и attention_mask; к ключам можно обращаться и как к атрибутам: enc.input_ids."""

    def __getattr__(self, item):
        try:
            return self[item]
        except KeyError:
            raise AttributeError(item) from None


class BertTokenizer:
    """Токенизатор WordPiece модели семейства BERT (в браузере — distilbert-base-uncased)."""

    model_input_names = ["input_ids", "attention_mask"]
    padding_side = "right"

    def __init__(self, vocab, name_or_path="", do_lower_case=True, model_max_length=512):
        self.vocab = dict(vocab)
        self.ids_to_tokens = {i: t for t, i in self.vocab.items()}
        self.name_or_path = name_or_path
        self.do_lower_case = do_lower_case
        self.model_max_length = model_max_length
        self.max_input_chars_per_word = 100
        self.unk_token, self.sep_token, self.pad_token = SPECIAL["unk"], SPECIAL["sep"], SPECIAL["pad"]
        self.cls_token, self.mask_token = SPECIAL["cls"], SPECIAL["mask"]
        self.all_special_tokens = [self.unk_token, self.sep_token, self.pad_token, self.cls_token, self.mask_token]

    # ---------- свойства, как у настоящего токенизатора ----------
    @property
    def vocab_size(self):
        return len(self.vocab)

    def __len__(self):
        return len(self.vocab)

    def get_vocab(self):
        return dict(self.vocab)

    @property
    def unk_token_id(self):
        return self.vocab[self.unk_token]

    @property
    def sep_token_id(self):
        return self.vocab[self.sep_token]

    @property
    def pad_token_id(self):
        return self.vocab[self.pad_token]

    @property
    def cls_token_id(self):
        return self.vocab[self.cls_token]

    @property
    def mask_token_id(self):
        return self.vocab[self.mask_token]

    @property
    def all_special_ids(self):
        return [self.vocab[t] for t in self.all_special_tokens]

    def __repr__(self):
        return ("BertTokenizer(name_or_path='%s', vocab_size=%d, model_max_length=%d, padding_side='right', "
                "special_tokens=%s) — браузерная версия, алгоритм WordPiece" % (
                    self.name_or_path, self.vocab_size, self.model_max_length, self.all_special_tokens))

    # ---------- разбиение на токены ----------
    def _clean_text(self, text):
        out = []
        for ch in text:
            cp = ord(ch)
            if cp == 0 or cp == 0xFFFD or _is_control(ch):
                continue
            out.append(" " if _is_whitespace(ch) else ch)
        return "".join(out)

    def _tokenize_chinese_chars(self, text):
        out = []
        for ch in text:
            if _is_chinese_char(ord(ch)):
                out.extend([" ", ch, " "])
            else:
                out.append(ch)
        return "".join(out)

    @staticmethod
    def _strip_accents(text):
        return "".join(ch for ch in unicodedata.normalize("NFD", text) if unicodedata.category(ch) != "Mn")

    @staticmethod
    def _split_on_punc(text):
        out, start_new = [], True
        for ch in text:
            if _is_punctuation(ch):
                out.append([ch])
                start_new = True
            else:
                if start_new:
                    out.append([])
                start_new = False
                out[-1].append(ch)
        return ["".join(x) for x in out]

    def _basic_tokenize(self, text):
        text = self._tokenize_chinese_chars(self._clean_text(text))
        text = unicodedata.normalize("NFC", text)
        pieces = []
        for token in _whitespace_split(text):
            if self.do_lower_case:
                # нижний регистр посимвольно, как в transformers: str.lower() превратил бы «Σ» в конце слова в «ς»
                token = self._strip_accents("".join(ch.lower() for ch in token))
            pieces.extend(self._split_on_punc(token))
        return _whitespace_split(" ".join(pieces))

    def _wordpiece(self, word):
        if len(word) > self.max_input_chars_per_word:
            return [self.unk_token]
        pieces, start = [], 0
        while start < len(word):
            end, current = len(word), None
            while start < end:
                sub = word[start:end]
                if start > 0:
                    sub = "##" + sub
                if sub in self.vocab:
                    current = sub
                    break
                end -= 1
            if current is None:
                return [self.unk_token]
            pieces.append(current)
            start = end
        return pieces

    def _split_special(self, text):
        """Специальные токены вида [SEP], написанные в тексте, не делятся и не переводятся в нижний регистр."""
        parts = [text]
        for special in self.all_special_tokens:
            next_parts = []
            for part in parts:
                if part in self.all_special_tokens:
                    next_parts.append(part)
                    continue
                chunks = part.split(special)
                for i, chunk in enumerate(chunks):
                    if i:
                        next_parts.append(special)
                    next_parts.append(chunk)
            parts = next_parts
        return [p for p in parts if p]

    def tokenize(self, text):
        """Текст → список токенов-строк (без [CLS] и [SEP])."""
        if not isinstance(text, str):
            raise TypeError("tokenize принимает одну строку, а получил %s. Для списка текстов вызовите tokenizer(список)."
                            % type(text).__name__)
        tokens = []
        for part in self._split_special(text):
            if part in self.all_special_tokens:
                tokens.append(part)
                continue
            for word in self._basic_tokenize(part):
                tokens.extend(self._wordpiece(word))
        return tokens

    # ---------- токены ↔ номера ----------
    def convert_tokens_to_ids(self, tokens):
        if isinstance(tokens, str):
            return self.vocab.get(tokens, self.unk_token_id)
        return [self.vocab.get(t, self.unk_token_id) for t in tokens]

    def convert_ids_to_tokens(self, ids, skip_special_tokens=False):
        single = isinstance(ids, int) or (hasattr(ids, "ndim") and getattr(ids, "ndim", 1) == 0)
        seq = [int(ids)] if single else [int(i) for i in ids]
        special = set(self.all_special_ids)
        out = [self.ids_to_tokens.get(i, self.unk_token) for i in seq if not (skip_special_tokens and i in special)]
        return out[0] if single else out

    def encode(self, text, add_special_tokens=True, truncation=False, max_length=None):
        return list(self(text, add_special_tokens=add_special_tokens, truncation=truncation, max_length=max_length)["input_ids"])

    _CLEANUP = ((" .", "."), (" ?", "?"), (" !", "!"), (" ,", ","), (" ' ", "'"), (" n't", "n't"), (" 'm", "'m"),
                (" do not", " don't"), (" 's", "'s"), (" 've", "'ve"), (" 're", "'re"))
    _CLEANUP_SPACES = ((" .", "."), (" ?", "?"), (" !", "!"), (" ,", ","), (" ' ", "'"), (" n't", "n't"), (" 'm", "'m"),
                       (" 's", "'s"), (" 've", "'ve"), (" 're", "'re"))

    def decode(self, ids, skip_special_tokens=False, clean_up_tokenization_spaces=False):
        """Номера → текст: «##»-куски приклеиваются к предыдущему токену, остальные разделяются пробелом."""
        if hasattr(ids, "tolist"):
            ids = ids.tolist()
        if isinstance(ids, int):
            ids = [ids]
        if ids and isinstance(ids[0], list):
            raise TypeError("decode принимает одну последовательность номеров; для нескольких — batch_decode.")
        tokens = self.convert_ids_to_tokens(ids, skip_special_tokens=skip_special_tokens)
        pieces = []
        for i, token in enumerate(tokens):
            if i:
                token = token[2:] if token.startswith("##") else " " + token
            for a, b in self._CLEANUP:      # как декодер WordPiece в transformers: для каждого токена отдельно
                token = token.replace(a, b)
            pieces.append(token)
        text = "".join(pieces)
        if clean_up_tokenization_spaces:
            for a, b in self._CLEANUP_SPACES:
                text = text.replace(a, b)
        return text

    def batch_decode(self, sequences, skip_special_tokens=False, clean_up_tokenization_spaces=False):
        if hasattr(sequences, "tolist"):
            sequences = sequences.tolist()
        return [self.decode(s, skip_special_tokens, clean_up_tokenization_spaces) for s in sequences]

    # ---------- главное: tokenizer(тексты, ...) ----------
    def __call__(self, text, padding=False, truncation=False, max_length=None, return_tensors=None,
                 add_special_tokens=True, return_attention_mask=True, **kwargs):
        if return_tensors in ("pt", "tf", "jax"):
            raise _hub.BrowserLimitation(
                "В браузерной версии нет PyTorch: вместо return_tensors='%s' используйте return_tensors='np' — "
                "получите массивы NumPy с теми же числами. В Colab с настоящей библиотекой работает и 'pt'." % return_tensors)
        if return_tensors not in (None, "np"):
            raise ValueError("return_tensors может быть None или 'np', а получено %r." % (return_tensors,))
        if "text_pair" in kwargs or (isinstance(text, (list, tuple)) and text and isinstance(text[0], (list, tuple))):
            raise _hub.BrowserLimitation("Пары текстов (вопрос и контекст) браузерная версия не поддерживает — "
                                         "это делают в Colab: %s" % _hub.COLAB)
        single = isinstance(text, str)
        if not single and not isinstance(text, (list, tuple)):
            raise TypeError("Токенизатору нужен текст или список текстов, а получено %s." % type(text).__name__)
        texts = [text] if single else list(text)
        for t in texts:
            if not isinstance(t, str):
                raise TypeError("Все элементы списка должны быть строками, а встретилось %s." % type(t).__name__)

        if truncation and max_length is None:
            max_length = self.model_max_length
        if padding == "max_length" and max_length is None:
            max_length = self.model_max_length
        ids_list = []
        for t in texts:
            ids = self.convert_tokens_to_ids(self.tokenize(t))
            if truncation and max_length is not None:
                ids = ids[: max(max_length - (2 if add_special_tokens else 0), 0)]
            if add_special_tokens:
                ids = [self.cls_token_id] + ids + [self.sep_token_id]
            ids_list.append(ids)
        masks = [[1] * len(ids) for ids in ids_list]

        if padding in (True, "longest") or padding == "max_length":
            target = max(len(ids) for ids in ids_list) if padding in (True, "longest") else max_length
            for ids, mask in zip(ids_list, masks):
                extra = max(target - len(ids), 0)
                ids.extend([self.pad_token_id] * extra)
                mask.extend([0] * extra)
        elif padding not in (False, None, "do_not_pad"):
            raise ValueError("padding может быть False, True, 'longest' или 'max_length', а получено %r." % (padding,))

        if return_tensors == "np":
            import numpy as np
            if len({len(ids) for ids in ids_list}) > 1:
                raise ValueError(
                    "Тексты разной длины нельзя сложить в одну таблицу (массив NumPy): добавьте padding=True — "
                    "короткие последовательности дополнятся токеном [PAD] до самой длинной.")
            out = BatchEncoding(input_ids=np.array(ids_list, dtype=np.int64))
            if return_attention_mask:
                out["attention_mask"] = np.array(masks, dtype=np.int64)
            return out
        out = BatchEncoding(input_ids=ids_list[0] if single else ids_list)
        if return_attention_mask:
            out["attention_mask"] = masks[0] if single else masks
        return out


def load_bert_tokenizer(name):
    files = _hub.MODELS[name]
    with open(_hub.data_file(files["vocab"]), encoding="utf-8") as fh:
        vocab = {line.rstrip("\n"): i for i, line in enumerate(fh) if line.rstrip("\n")}
    return BertTokenizer(vocab, name_or_path=name)
