"""NICE e-campus 로그인 encryptData. JS login-crypto.cjs 와 같은 벡터."""

from __future__ import annotations

import base64
import secrets

from lib.util import url_encode

KEYSTR = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
DELIM = "!#!"

PC2 = [
    [0, 0x4, 0x20000000, 0x20000004, 0x10000, 0x10004, 0x20010000, 0x20010004, 0x200, 0x204,
     0x20000200, 0x20000204, 0x10200, 0x10204, 0x20010200, 0x20010204],
    [0, 0x1, 0x100000, 0x100001, 0x4000000, 0x4000001, 0x4100000, 0x4100001, 0x100, 0x101,
     0x100100, 0x100101, 0x4000100, 0x4000101, 0x4100100, 0x4100101],
    [0, 0x8, 0x800, 0x808, 0x1000000, 0x1000008, 0x1000800, 0x1000808, 0, 0x8, 0x800, 0x808,
     0x1000000, 0x1000008, 0x1000800, 0x1000808],
    [0, 0x200000, 0x8000000, 0x8200000, 0x2000, 0x202000, 0x8002000, 0x8202000, 0x20000, 0x220000,
     0x8020000, 0x8220000, 0x22000, 0x222000, 0x8022000, 0x8222000],
    [0, 0x40000, 0x10, 0x40010, 0, 0x40000, 0x10, 0x40010, 0x1000, 0x41000, 0x1010, 0x41010, 0x1000,
     0x41000, 0x1010, 0x41010],
    [0, 0x400, 0x20, 0x420, 0, 0x400, 0x20, 0x420, 0x2000000, 0x2000400, 0x2000020, 0x2000420,
     0x2000000, 0x2000400, 0x2000020, 0x2000420],
    [0, 0x10000000, 0x80000, 0x10080000, 0x2, 0x10000002, 0x80002, 0x10080002, 0, 0x10000000,
     0x80000, 0x10080000, 0x2, 0x10000002, 0x80002, 0x10080002],
    [0, 0x10000, 0x800, 0x10800, 0x20000000, 0x20010000, 0x20000800, 0x20010800, 0x20000, 0x30000,
     0x20800, 0x30800, 0x20020000, 0x20030000, 0x20020800, 0x20030800],
    [0, 0x40000, 0, 0x40000, 0x2, 0x40002, 0x2, 0x40002, 0x2000000, 0x2040000, 0x2000000, 0x2040000,
     0x2000002, 0x2040002, 0x2000002, 0x2040002],
    [0, 0x10000000, 0x8, 0x10000008, 0, 0x10000000, 0x8, 0x10000008, 0x400, 0x10000400, 0x408,
     0x10000408, 0x400, 0x10000400, 0x408, 0x10000408],
    [0, 0x20, 0, 0x20, 0x100000, 0x100020, 0x100000, 0x100020, 0x2000, 0x2020, 0x2000, 0x2020,
     0x102000, 0x102020, 0x102000, 0x102020],
    [0, 0x1000000, 0x200, 0x1000200, 0x200000, 0x1200000, 0x200200, 0x1200200, 0x4000000, 0x5000000,
     0x4000200, 0x5000200, 0x4200000, 0x5200000, 0x4200200, 0x5200200],
    [0, 0x1000, 0x8000000, 0x8001000, 0x80000, 0x81000, 0x8080000, 0x8081000, 0x10, 0x1010,
     0x8000010, 0x8001010, 0x80010, 0x81010, 0x8080010, 0x8081010],
    [0, 0x4, 0x100, 0x104, 0, 0x4, 0x100, 0x104, 0x1, 0x5, 0x101, 0x105, 0x1, 0x5, 0x101, 0x105],
]

SP1 = [
    0x1010400, 0, 0x10000, 0x1010404, 0x1010004, 0x10404, 0x4, 0x10000,
    0x400, 0x1010400, 0x1010404, 0x400, 0x1000404, 0x1010004, 0x1000000, 0x4,
    0x404, 0x1000400, 0x1000400, 0x10400, 0x10400, 0x1010000, 0x1010000, 0x1000404,
    0x10004, 0x1000004, 0x1000004, 0x10004, 0, 0x404, 0x10404, 0x1000000,
    0x10000, 0x1010404, 0x4, 0x1010000, 0x1010400, 0x1000000, 0x1000000, 0x400,
    0x1010004, 0x10000, 0x10400, 0x1000004, 0x400, 0x4, 0x1000404, 0x10404,
    0x1010404, 0x10004, 0x1010000, 0x1000404, 0x1000004, 0x404, 0x10404, 0x1010400,
    0x404, 0x1000400, 0x1000400, 0, 0x10004, 0x10400, 0, 0x1010004,
]
SP2 = [
    0x80108020, 0x80008000, 0x8000, 0x108020, 0x100000, 0x20, 0x80100020, 0x80008020,
    0x80000020, 0x80108020, 0x80108000, 0x80000000, 0x80008000, 0x100000, 0x20, 0x80100020,
    0x108000, 0x100020, 0x80008020, 0, 0x80000000, 0x8000, 0x108020, 0x80100000,
    0x100020, 0x80000020, 0, 0x108000, 0x8020, 0x80108000, 0x80100000, 0x8020,
    0, 0x108020, 0x80100020, 0x100000, 0x80008020, 0x80100000, 0x80108000, 0x8000,
    0x80100000, 0x80008000, 0x20, 0x80108020, 0x108020, 0x20, 0x8000, 0x80000000,
    0x8020, 0x80108000, 0x100000, 0x80000020, 0x100020, 0x80008020, 0x80000020, 0x100020,
    0x108000, 0, 0x80008000, 0x8020, 0x80000000, 0x80100020, 0x80108020, 0x108000,
]
SP3 = [
    0x208, 0x8020200, 0, 0x8020008, 0x8000200, 0, 0x20208, 0x8000200,
    0x20008, 0x8000008, 0x8000008, 0x20000, 0x8020208, 0x20008, 0x8020000, 0x208,
    0x8000000, 0x8, 0x8020200, 0x200, 0x20200, 0x8020000, 0x8020008, 0x20208,
    0x8000208, 0x20200, 0x20000, 0x8000208, 0x8, 0x8020208, 0x200, 0x8000000,
    0x8020200, 0x8000000, 0x20008, 0x208, 0x20000, 0x8020200, 0x8000200, 0,
    0x200, 0x20008, 0x8020208, 0x8000200, 0x8000008, 0x200, 0, 0x8020008,
    0x8000208, 0x20000, 0x8000000, 0x8020208, 0x8, 0x20208, 0x20200, 0x8000008,
    0x8020000, 0x8000208, 0x208, 0x8020000, 0x20208, 0x8, 0x8020008, 0x20200,
]
SP4 = [
    0x802001, 0x2081, 0x2081, 0x80, 0x802080, 0x800081, 0x800001, 0x2001, 0, 0x802000,
    0x802000, 0x802081, 0x81, 0, 0x800080, 0x800001, 0x1, 0x2000, 0x800000, 0x802001,
    0x80, 0x800000, 0x2001, 0x2080, 0x800081, 0x1, 0x2080, 0x800080, 0x2000, 0x802080,
    0x802081, 0x81, 0x800080, 0x800001, 0x802000, 0x802081, 0x81, 0, 0, 0x802000,
    0x2080, 0x800080, 0x800081, 0x1, 0x802001, 0x2081, 0x2081, 0x80, 0x802081, 0x81,
    0x1, 0x2000, 0x800001, 0x2001, 0x802080, 0x800081, 0x2001, 0x2080, 0x800000, 0x802001,
    0x80, 0x800000, 0x2000, 0x802080,
]
SP5 = [
    0x100, 0x2080100, 0x2080000, 0x42000100, 0x80000, 0x100, 0x40000000, 0x2080000,
    0x40080100, 0x80000, 0x2000100, 0x40080100, 0x42000100, 0x42080000, 0x80100, 0x40000000,
    0x2000000, 0x40080000, 0x40080000, 0, 0x40000100, 0x42080100, 0x42080100, 0x2000100,
    0x42080000, 0x40000100, 0, 0x42000000, 0x2080100, 0x2000000, 0x42000000, 0x80100,
    0x80000, 0x42000100, 0x100, 0x2000000, 0x40000000, 0x2080000, 0x42000100, 0x40080100,
    0x2000100, 0x40000000, 0x42080000, 0x2080100, 0x40080100, 0x100, 0x2000000, 0x42080000,
    0x42080100, 0x80100, 0x42000000, 0x42080100, 0x2080000, 0, 0x40080000, 0x42000000,
    0x80100, 0x2000100, 0x40000100, 0x80000, 0, 0x40080000, 0x2080100, 0x40000100,
]
SP6 = [
    0x20000010, 0x20400000, 0x4000, 0x20404010, 0x20400000, 0x10, 0x20404010, 0x400000,
    0x20004000, 0x404010, 0x400000, 0x20000010, 0x400010, 0x20004000, 0x20000000, 0x4010,
    0, 0x400010, 0x20004010, 0x4000, 0x404000, 0x20004010, 0x10, 0x20400010,
    0x20400010, 0, 0x404010, 0x20404000, 0x4010, 0x404000, 0x20404000, 0x20000000,
    0x20004000, 0x10, 0x20400010, 0x404000, 0x20404010, 0x400000, 0x4010, 0x20000010,
    0x400000, 0x20004000, 0x20000000, 0x4010, 0x20000010, 0x20404010, 0x404000, 0x20400000,
    0x404010, 0x20404000, 0, 0x20400010, 0x10, 0x4000, 0x20400000, 0x404010,
    0x4000, 0x400010, 0x20004010, 0, 0x20404000, 0x20000000, 0x400010, 0x20004010,
]
SP7 = [
    0x200000, 0x4200002, 0x4000802, 0, 0x800, 0x4000802, 0x200802, 0x4200800,
    0x4200802, 0x200000, 0, 0x4000002, 0x2, 0x4000000, 0x4200002, 0x802,
    0x4000800, 0x200802, 0x200002, 0x4000800, 0x4000002, 0x4200000, 0x4200800, 0x200002,
    0x4200000, 0x800, 0x802, 0x4200802, 0x200800, 0x2, 0x4000000, 0x200800,
    0x4000000, 0x200800, 0x200000, 0x4000802, 0x4000802, 0x4200002, 0x4200002, 0x2,
    0x200002, 0x4000000, 0x4000800, 0x200000, 0x4200800, 0x802, 0x200802, 0x4200800,
    0x802, 0x4000002, 0x4200802, 0x4200000, 0x200800, 0, 0x2, 0x4200802,
    0, 0x200802, 0x4200000, 0x800, 0x4000002, 0x4000800, 0x800, 0x200002,
]
SP8 = [
    0x10001040, 0x1000, 0x40000, 0x10041040, 0x10000000, 0x10001040, 0x40, 0x10000000,
    0x40040, 0x10040000, 0x10041040, 0x41000, 0x10041000, 0x41040, 0x1000, 0x40,
    0x10040000, 0x10000040, 0x10001000, 0x1040, 0x41000, 0x40040, 0x10040040, 0x10041000,
    0x1040, 0, 0, 0x10040040, 0x10000040, 0x10001000, 0x41040, 0x40000,
    0x41040, 0x40000, 0x10041000, 0x1000, 0x40, 0x10040040, 0x1000, 0x41040,
    0x10001000, 0x40, 0x10000040, 0x10040000, 0x10040040, 0x10000000, 0x40000, 0x10001040,
    0, 0x10041040, 0x40040, 0x10000040, 0x10040000, 0x10001000, 0x10001040, 0,
    0x10041040, 0x41000, 0x41000, 0x1040, 0x1040, 0x40040, 0x10000000, 0x10041000,
]


def _u32(x: int) -> int:
    """32비트로 자른다."""
    return x & 0xFFFFFFFF


def _bget(s: bytes, i: int) -> int:
    """범위 밖이면 0."""
    return s[i] if i < len(s) else 0


def _des_create_keys(key: bytes) -> list[int]:
    """NICE DES 서브키. 24바이트면 3중 DES."""
    shifts = [0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0]
    iterations = 3 if len(key) >= 24 else 1
    keys: list[int] = []
    m = 0
    for _j in range(iterations):
        left = (_bget(key, m) << 24) | (_bget(key, m + 1) << 16) | (_bget(key, m + 2) << 8) | _bget(key, m + 3)
        right = (_bget(key, m + 4) << 24) | (_bget(key, m + 5) << 16) | (_bget(key, m + 6) << 8) | _bget(key, m + 7)
        m += 8
        left, right = _u32(left), _u32(right)
        temp = ((left >> 4) ^ right) & 0x0F0F0F0F
        right ^= temp
        left = _u32(left ^ (temp << 4))
        temp = ((right >> 16) ^ left) & 0x0000FFFF
        left ^= temp
        right = _u32(right ^ (temp << 16))
        temp = ((left >> 2) ^ right) & 0x33333333
        right ^= temp
        left = _u32(left ^ (temp << 2))
        temp = ((right >> 16) ^ left) & 0x0000FFFF
        left ^= temp
        right = _u32(right ^ (temp << 16))
        temp = ((left >> 1) ^ right) & 0x55555555
        right ^= temp
        left = _u32(left ^ (temp << 1))
        temp = ((right >> 8) ^ left) & 0x00FF00FF
        left ^= temp
        right = _u32(right ^ (temp << 8))
        temp = ((left >> 1) ^ right) & 0x55555555
        right ^= temp
        left = _u32(left ^ (temp << 1))

        temp = _u32((left << 8) | ((right >> 20) & 0x000000F0))
        left = _u32((right << 24) | ((right << 8) & 0xFF0000) | ((right >> 8) & 0xFF00) | ((right >> 24) & 0xF0))
        right = temp

        for i in range(16):
            if shifts[i]:
                left = _u32((left << 2) | (left >> 26))
                right = _u32((right << 2) | (right >> 26))
            else:
                left = _u32((left << 1) | (left >> 27))
                right = _u32((right << 1) | (right >> 27))
            left &= 0xFFFFFFF0
            right &= 0xFFFFFFF0
            lefttemp = (
                PC2[0][left >> 28]
                | PC2[1][(left >> 24) & 0xF]
                | PC2[2][(left >> 20) & 0xF]
                | PC2[3][(left >> 16) & 0xF]
                | PC2[4][(left >> 12) & 0xF]
                | PC2[5][(left >> 8) & 0xF]
                | PC2[6][(left >> 4) & 0xF]
            )
            righttemp = (
                PC2[7][right >> 28]
                | PC2[8][(right >> 24) & 0xF]
                | PC2[9][(right >> 20) & 0xF]
                | PC2[10][(right >> 16) & 0xF]
                | PC2[11][(right >> 12) & 0xF]
                | PC2[12][(right >> 8) & 0xF]
                | PC2[13][(right >> 4) & 0xF]
            )
            temp = ((righttemp >> 16) ^ lefttemp) & 0x0000FFFF
            keys.append(_u32(lefttemp ^ temp))
            keys.append(_u32(righttemp ^ (temp << 16)))
    return keys


def _nice_des(key: bytes, msg: bytes, encrypt: bool, mode: int, iv: bytes) -> bytes:
    """mode 1 은 CBC. 로그인 encryptData 는 암호화만 쓴다."""
    keys = _des_create_keys(key)
    nkeys = len(keys)
    if nkeys == 32:
        looping = [0, 32, 2] if encrypt else [30, -2, -2]
    elif encrypt:
        looping = [0, 32, 2, 62, 30, -2, 64, 96, 2]
    else:
        looping = [94, 62, -2, 32, 64, 2, 30, -2, -2]

    cbcleft = cbcright = cbcleft2 = cbcright2 = 0
    if mode == 1 and iv:
        cbcleft = (_bget(iv, 0) << 24) | (_bget(iv, 1) << 16) | (_bget(iv, 2) << 8) | _bget(iv, 3)
        cbcright = (_bget(iv, 4) << 24) | (_bget(iv, 5) << 16) | (_bget(iv, 6) << 8) | _bget(iv, 7)
        cbcleft, cbcright = _u32(cbcleft), _u32(cbcright)

    result = bytearray()
    m = 0
    msg_len = len(msg)
    while m < msg_len:
        left = (_bget(msg, m) << 24) | (_bget(msg, m + 1) << 16) | (_bget(msg, m + 2) << 8) | _bget(msg, m + 3)
        right = (_bget(msg, m + 4) << 24) | (_bget(msg, m + 5) << 16) | (_bget(msg, m + 6) << 8) | _bget(msg, m + 7)
        m += 8
        left, right = _u32(left), _u32(right)

        if mode == 1:
            if encrypt:
                left ^= cbcleft
                right ^= cbcright
            else:
                cbcleft2, cbcright2 = cbcleft, cbcright
                cbcleft, cbcright = left, right

        temp = ((left >> 4) ^ right) & 0x0F0F0F0F
        right ^= temp
        left = _u32(left ^ (temp << 4))
        temp = ((left >> 16) ^ right) & 0x0000FFFF
        right ^= temp
        left = _u32(left ^ (temp << 16))
        temp = ((right >> 2) ^ left) & 0x33333333
        left ^= temp
        right = _u32(right ^ (temp << 2))
        temp = ((right >> 8) ^ left) & 0x00FF00FF
        left ^= temp
        right = _u32(right ^ (temp << 8))
        temp = ((left >> 1) ^ right) & 0x55555555
        right ^= temp
        left = _u32(left ^ (temp << 1))
        left = _u32((left << 1) | (left >> 31))
        right = _u32((right << 1) | (right >> 31))

        j = 0
        while j < len(looping):
            endloop = looping[j + 1]
            loopinc = looping[j + 2]
            i = looping[j]
            while i != endloop:
                right1 = right ^ keys[i]
                right2 = _u32((right >> 4) | (right << 28)) ^ keys[i + 1]
                temp = left
                left = right
                right = _u32(
                    temp
                    ^ (
                        SP2[(right1 >> 24) & 0x3F]
                        | SP4[(right1 >> 16) & 0x3F]
                        | SP6[(right1 >> 8) & 0x3F]
                        | SP8[right1 & 0x3F]
                        | SP1[(right2 >> 24) & 0x3F]
                        | SP3[(right2 >> 16) & 0x3F]
                        | SP5[(right2 >> 8) & 0x3F]
                        | SP7[right2 & 0x3F]
                    )
                )
                i += loopinc
            left, right = right, left
            j += 3

        left = _u32((left >> 1) | (left << 31))
        right = _u32((right >> 1) | (right << 31))
        temp = ((left >> 1) ^ right) & 0x55555555
        right ^= temp
        left = _u32(left ^ (temp << 1))
        temp = ((right >> 8) ^ left) & 0x00FF00FF
        left ^= temp
        right = _u32(right ^ (temp << 8))
        temp = ((right >> 2) ^ left) & 0x33333333
        left ^= temp
        right = _u32(right ^ (temp << 2))
        temp = ((left >> 16) ^ right) & 0x0000FFFF
        right ^= temp
        left = _u32(left ^ (temp << 16))
        temp = ((left >> 4) ^ right) & 0x0F0F0F0F
        right ^= temp
        left = _u32(left ^ (temp << 4))

        if mode == 1:
            if encrypt:
                cbcleft, cbcright = left, right
            else:
                left ^= cbcleft2
                right ^= cbcright2

        result.extend(
            [
                (left >> 24) & 0xFF,
                (left >> 16) & 0xFF,
                (left >> 8) & 0xFF,
                left & 0xFF,
                (right >> 24) & 0xFF,
                (right >> 16) & 0xFF,
                (right >> 8) & 0xFF,
                right & 0xFF,
            ]
        )
    return bytes(result)


def _b64_encode(data: bytes) -> str:
    """표준 Base64. NICE 알파벳과 같다."""
    return base64.b64encode(data).decode("ascii")


def random_key24() -> str:
    """로그인마다 바뀌는 24자 키."""
    return "".join(secrets.choice(KEYSTR[:64]) for _ in range(24))


def make_encrypt_info(plain: str, key24: str) -> str:
    """평문을 DES-CBC 한 뒤 `키!#!암호` 를 Base64 로 묶는다."""
    key_b = key24.encode("ascii")
    cipher = _nice_des(key_b, plain.encode("utf-8"), True, 1, key_b)
    packed = key_b + DELIM.encode("ascii") + cipher
    return _b64_encode(packed)


def make_encrypt_data_with_key(user_id: str, password: str, key24: str) -> str:
    """고정 키로 encryptData 를 만든다. 단위 테스트용."""
    enc_id = url_encode(user_id or "")
    enc_pw = url_encode(password or "")
    plain = f"{enc_id}{DELIM}{enc_pw}{DELIM}undefined{DELIM}undefined"
    return make_encrypt_info(plain, key24)


def make_encrypt_data(user_id: str, password: str) -> str:
    """로그인 POST 의 encryptData 값."""
    return make_encrypt_data_with_key(user_id, password, random_key24())
