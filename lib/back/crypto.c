// 커스텀 라이브러리
#include "crypto.h"
#include "../util.h"

// 기본 라이브러리
#include <stdint.h>

// NICE e-campus 로그인 암호 (login-crypto.cjs 와 동일)
// JS 의 >>> / 음수 시프트는 32비트 마스크로 맞춤

static const char KEYSTR[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="; // Base64 표
static const char DELIM[] = "!#!";                                  // 평문 구분자

// 이 파일 안에서만 쓰는 DES 도우미
static unsigned char bget(const unsigned char *s, size_t n, size_t i); // 범위 밖이면 0
static void des_create_keys(const unsigned char *key, size_t key_len, uint32_t *keys, int *nkeys); // 라운드 키
static int nice_des(const unsigned char *key, size_t key_len, const unsigned char *msg, size_t msg_len,
                    int encrypt, int mode, const unsigned char *iv, size_t iv_len, unsigned char **out,
                    size_t *out_len);                               // DES/CBC
static int b64_encode(const unsigned char *in, size_t n, char *out, size_t outsz); // Base64
static void random_key24(char *out);                                // 24글자 난수 키
static int make_encrypt_info(const char *plain, const char *key24, char *out, size_t outsz); // 암호문 포장

static const uint32_t PC2[14][16] = {
    {0, 0x4, 0x20000000, 0x20000004, 0x10000, 0x10004, 0x20010000, 0x20010004, 0x200, 0x204,
     0x20000200, 0x20000204, 0x10200, 0x10204, 0x20010200, 0x20010204},
    {0, 0x1, 0x100000, 0x100001, 0x4000000, 0x4000001, 0x4100000, 0x4100001, 0x100, 0x101,
     0x100100, 0x100101, 0x4000100, 0x4000101, 0x4100100, 0x4100101},
    {0, 0x8, 0x800, 0x808, 0x1000000, 0x1000008, 0x1000800, 0x1000808, 0, 0x8, 0x800, 0x808,
     0x1000000, 0x1000008, 0x1000800, 0x1000808},
    {0, 0x200000, 0x8000000, 0x8200000, 0x2000, 0x202000, 0x8002000, 0x8202000, 0x20000, 0x220000,
     0x8020000, 0x8220000, 0x22000, 0x222000, 0x8022000, 0x8222000},
    {0, 0x40000, 0x10, 0x40010, 0, 0x40000, 0x10, 0x40010, 0x1000, 0x41000, 0x1010, 0x41010, 0x1000,
     0x41000, 0x1010, 0x41010},
    {0, 0x400, 0x20, 0x420, 0, 0x400, 0x20, 0x420, 0x2000000, 0x2000400, 0x2000020, 0x2000420,
     0x2000000, 0x2000400, 0x2000020, 0x2000420},
    {0, 0x10000000, 0x80000, 0x10080000, 0x2, 0x10000002, 0x80002, 0x10080002, 0, 0x10000000,
     0x80000, 0x10080000, 0x2, 0x10000002, 0x80002, 0x10080002},
    {0, 0x10000, 0x800, 0x10800, 0x20000000, 0x20010000, 0x20000800, 0x20010800, 0x20000, 0x30000,
     0x20800, 0x30800, 0x20020000, 0x20030000, 0x20020800, 0x20030800},
    {0, 0x40000, 0, 0x40000, 0x2, 0x40002, 0x2, 0x40002, 0x2000000, 0x2040000, 0x2000000, 0x2040000,
     0x2000002, 0x2040002, 0x2000002, 0x2040002},
    {0, 0x10000000, 0x8, 0x10000008, 0, 0x10000000, 0x8, 0x10000008, 0x400, 0x10000400, 0x408,
     0x10000408, 0x400, 0x10000400, 0x408, 0x10000408},
    {0, 0x20, 0, 0x20, 0x100000, 0x100020, 0x100000, 0x100020, 0x2000, 0x2020, 0x2000, 0x2020,
     0x102000, 0x102020, 0x102000, 0x102020},
    {0, 0x1000000, 0x200, 0x1000200, 0x200000, 0x1200000, 0x200200, 0x1200200, 0x4000000, 0x5000000,
     0x4000200, 0x5000200, 0x4200000, 0x5200000, 0x4200200, 0x5200200},
    {0, 0x1000, 0x8000000, 0x8001000, 0x80000, 0x81000, 0x8080000, 0x8081000, 0x10, 0x1010,
     0x8000010, 0x8001010, 0x80010, 0x81010, 0x8080010, 0x8081010},
    {0, 0x4, 0x100, 0x104, 0, 0x4, 0x100, 0x104, 0x1, 0x5, 0x101, 0x105, 0x1, 0x5, 0x101, 0x105}};

static const uint32_t SP1[64] = {
    0x1010400, 0,          0x10000,    0x1010404, 0x1010004, 0x10404,    0x4,        0x10000,
    0x400,     0x1010400,  0x1010404,  0x400,     0x1000404, 0x1010004,  0x1000000,  0x4,
    0x404,     0x1000400,  0x1000400,  0x10400,   0x10400,   0x1010000,  0x1010000,  0x1000404,
    0x10004,   0x1000004,  0x1000004,  0x10004,   0,         0x404,      0x10404,    0x1000000,
    0x10000,   0x1010404,  0x4,        0x1010000, 0x1010400, 0x1000000,  0x1000000,  0x400,
    0x1010004, 0x10000,    0x10400,    0x1000004, 0x400,     0x4,        0x1000404,  0x10404,
    0x1010404, 0x10004,    0x1010000,  0x1000404, 0x1000004, 0x404,      0x10404,    0x1010400,
    0x404,     0x1000400,  0x1000400,  0,         0x10004,   0x10400,    0,          0x1010004};
static const uint32_t SP2[64] = {
    0x80108020, 0x80008000, 0x8000,     0x108020,   0x100000,   0x20,       0x80100020, 0x80008020,
    0x80000020, 0x80108020, 0x80108000, 0x80000000, 0x80008000, 0x100000,   0x20,       0x80100020,
    0x108000,   0x100020,   0x80008020, 0,          0x80000000, 0x8000,     0x108020,   0x80100000,
    0x100020,   0x80000020, 0,          0x108000,   0x8020,     0x80108000, 0x80100000, 0x8020,
    0,          0x108020,   0x80100020, 0x100000,   0x80008020, 0x80100000, 0x80108000, 0x8000,
    0x80100000, 0x80008000, 0x20,       0x80108020, 0x108020,   0x20,       0x8000,     0x80000000,
    0x8020,     0x80108000, 0x100000,   0x80000020, 0x100020,   0x80008020, 0x80000020, 0x100020,
    0x108000,   0,          0x80008000, 0x8020,     0x80000000, 0x80100020, 0x80108020, 0x108000};
static const uint32_t SP3[64] = {
    0x208,     0x8020200, 0,         0x8020008, 0x8000200, 0,         0x20208,   0x8000200,
    0x20008,   0x8000008, 0x8000008, 0x20000,   0x8020208, 0x20008,   0x8020000, 0x208,
    0x8000000, 0x8,       0x8020200, 0x200,     0x20200,   0x8020000, 0x8020008, 0x20208,
    0x8000208, 0x20200,   0x20000,   0x8000208, 0x8,       0x8020208, 0x200,     0x8000000,
    0x8020200, 0x8000000, 0x20008,   0x208,     0x20000,   0x8020200, 0x8000200, 0,
    0x200,     0x20008,   0x8020208, 0x8000200, 0x8000008, 0x200,     0,         0x8020008,
    0x8000208, 0x20000,   0x8000000, 0x8020208, 0x8,       0x20208,   0x20200,   0x8000008,
    0x8020000, 0x8000208, 0x208,     0x8020000, 0x20208,   0x8,       0x8020008, 0x20200};
static const uint32_t SP4[64] = {
    0x802001, 0x2081,   0x2081,   0x80,     0x802080, 0x800081, 0x800001, 0x2001,   0,        0x802000,
    0x802000, 0x802081, 0x81,     0,        0x800080, 0x800001, 0x1,      0x2000,   0x800000, 0x802001,
    0x80,     0x800000, 0x2001,   0x2080,   0x800081, 0x1,      0x2080,   0x800080, 0x2000,   0x802080,
    0x802081, 0x81,     0x800080, 0x800001, 0x802000, 0x802081, 0x81,     0,        0,        0x802000,
    0x2080,   0x800080, 0x800081, 0x1,      0x802001, 0x2081,   0x2081,   0x80,     0x802081, 0x81,
    0x1,      0x2000,   0x800001, 0x2001,   0x802080, 0x800081, 0x2001,   0x2080,   0x800000, 0x802001,
    0x80,     0x800000, 0x2000,   0x802080};
static const uint32_t SP5[64] = {
    0x100,      0x2080100,  0x2080000,  0x42000100, 0x80000,    0x100,      0x40000000, 0x2080000,
    0x40080100, 0x80000,    0x2000100,  0x40080100, 0x42000100, 0x42080000, 0x80100,    0x40000000,
    0x2000000,  0x40080000, 0x40080000, 0,          0x40000100, 0x42080100, 0x42080100, 0x2000100,
    0x42080000, 0x40000100, 0,          0x42000000, 0x2080100,  0x2000000,  0x42000000, 0x80100,
    0x80000,    0x42000100, 0x100,      0x2000000,  0x40000000, 0x2080000,  0x42000100, 0x40080100,
    0x2000100,  0x40000000, 0x42080000, 0x2080100,  0x40080100, 0x100,      0x2000000,  0x42080000,
    0x42080100, 0x80100,    0x42000000, 0x42080100, 0x2080000,  0,          0x40080000, 0x42000000,
    0x80100,    0x2000100,  0x40000100, 0x80000,    0,          0x40080000, 0x2080100,  0x40000100};
static const uint32_t SP6[64] = {
    0x20000010, 0x20400000, 0x4000,     0x20404010, 0x20400000, 0x10,       0x20404010, 0x400000,
    0x20004000, 0x404010,   0x400000,   0x20000010, 0x400010,   0x20004000, 0x20000000, 0x4010,
    0,          0x400010,   0x20004010, 0x4000,     0x404000,   0x20004010, 0x10,       0x20400010,
    0x20400010, 0,          0x404010,   0x20404000, 0x4010,     0x404000,   0x20404000, 0x20000000,
    0x20004000, 0x10,       0x20400010, 0x404000,   0x20404010, 0x400000,   0x4010,     0x20000010,
    0x400000,   0x20004000, 0x20000000, 0x4010,     0x20000010, 0x20404010, 0x404000,   0x20400000,
    0x404010,   0x20404000, 0,          0x20400010, 0x10,       0x4000,     0x20400000, 0x404010,
    0x4000,     0x400010,   0x20004010, 0,          0x20404000, 0x20000000, 0x400010,   0x20004010};
static const uint32_t SP7[64] = {
    0x200000,  0x4200002, 0x4000802, 0,         0x800,     0x4000802, 0x200802,  0x4200800,
    0x4200802, 0x200000,  0,         0x4000002, 0x2,       0x4000000, 0x4200002, 0x802,
    0x4000800, 0x200802,  0x200002,  0x4000800, 0x4000002, 0x4200000, 0x4200800, 0x200002,
    0x4200000, 0x800,     0x802,     0x4200802, 0x200800,  0x2,       0x4000000, 0x200800,
    0x4000000, 0x200800,  0x200000,  0x4000802, 0x4000802, 0x4200002, 0x4200002, 0x2,
    0x200002,  0x4000000, 0x4000800, 0x200000,  0x4200800, 0x802,     0x200802,  0x4200800,
    0x802,     0x4000002, 0x4200802, 0x4200000, 0x200800,  0,         0x2,       0x4200802,
    0,         0x200802,  0x4200000, 0x800,     0x4000002, 0x4000800, 0x800,     0x200002};
static const uint32_t SP8[64] = {
    0x10001040, 0x1000,     0x40000,    0x10041040, 0x10000000, 0x10001040, 0x40,       0x10000000,
    0x40040,    0x10040000, 0x10041040, 0x41000,    0x10041000, 0x41040,    0x1000,     0x40,
    0x10040000, 0x10000040, 0x10001000, 0x1040,     0x41000,    0x40040,    0x10040040, 0x10041000,
    0x1040,     0,          0,          0x10040040, 0x10000040, 0x10001000, 0x41040,    0x40000,
    0x41040,    0x40000,    0x10041000, 0x1000,     0x40,       0x10040040, 0x1000,     0x41040,
    0x10001000, 0x40,       0x10000040, 0x10040000, 0x10040040, 0x10000000, 0x40000,    0x10001040,
    0,          0x10041040, 0x40040,    0x10000040, 0x10040000, 0x10001000, 0x10001040, 0,
    0x10041040, 0x41000,    0x41000,    0x1040,     0x1040,     0x40040,    0x10000000, 0x10041000};

// 버퍼 밖을 읽으면 0 (JS charCodeAt 와 같게)
static unsigned char bget(const unsigned char *s, size_t n, size_t i)
{
    return i < n ? s[i] : 0;
}

// 24바이트 키면 3DES, 아니면 DES 라운드 키를 만든다
static void des_create_keys(const unsigned char *key, size_t key_len, uint32_t *keys, int *nkeys)
{
    static const int shifts[16] = {0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0}; // 라운드 이동
    int iterations = key_len >= 24 ? 3 : 1; // 키 길이에 따른 반복
    size_t m = 0;                   // 키 바이트 위치
    int n = 0;                      // 만든 라운드 키 개수
    int j, i;                       // 반복 인덱스
    *nkeys = 32 * iterations;
    for (j = 0; j < iterations; j++) {
        uint32_t left, right, temp, lefttemp, righttemp; // PC1/PC2 중간 값
        left = ((uint32_t)bget(key, key_len, m) << 24) | ((uint32_t)bget(key, key_len, m + 1) << 16) |
               ((uint32_t)bget(key, key_len, m + 2) << 8) | (uint32_t)bget(key, key_len, m + 3);
        right = ((uint32_t)bget(key, key_len, m + 4) << 24) | ((uint32_t)bget(key, key_len, m + 5) << 16) |
                ((uint32_t)bget(key, key_len, m + 6) << 8) | (uint32_t)bget(key, key_len, m + 7);
        m += 8;
        temp = ((left >> 4) ^ right) & 0x0f0f0f0f;
        right ^= temp;
        left ^= (temp << 4);
        /* JS: right >>> -16  == right >>> 16 */
        temp = ((right >> 16) ^ left) & 0x0000ffff;
        left ^= temp;
        right ^= (temp << 16);
        temp = ((left >> 2) ^ right) & 0x33333333;
        right ^= temp;
        left ^= (temp << 2);
        temp = ((right >> 16) ^ left) & 0x0000ffff;
        left ^= temp;
        right ^= (temp << 16);
        temp = ((left >> 1) ^ right) & 0x55555555;
        right ^= temp;
        left ^= (temp << 1);
        temp = ((right >> 8) ^ left) & 0x00ff00ff;
        left ^= temp;
        right ^= (temp << 8);
        temp = ((left >> 1) ^ right) & 0x55555555;
        right ^= temp;
        left ^= (temp << 1);

        temp = (left << 8) | ((right >> 20) & 0x000000f0);
        left = (right << 24) | ((right << 8) & 0xff0000) | ((right >> 8) & 0xff00) | ((right >> 24) & 0xf0);
        right = temp;

        for (i = 0; i < 16; i++) {
            if (shifts[i]) {
                left = (left << 2) | (left >> 26);
                right = (right << 2) | (right >> 26);
            } else {
                left = (left << 1) | (left >> 27);
                right = (right << 1) | (right >> 27);
            }
            left &= 0xfffffff0;
            right &= 0xfffffff0;
            lefttemp = PC2[0][left >> 28] | PC2[1][(left >> 24) & 0xf] | PC2[2][(left >> 20) & 0xf] |
                       PC2[3][(left >> 16) & 0xf] | PC2[4][(left >> 12) & 0xf] | PC2[5][(left >> 8) & 0xf] |
                       PC2[6][(left >> 4) & 0xf];
            righttemp = PC2[7][right >> 28] | PC2[8][(right >> 24) & 0xf] | PC2[9][(right >> 20) & 0xf] |
                        PC2[10][(right >> 16) & 0xf] | PC2[11][(right >> 12) & 0xf] |
                        PC2[12][(right >> 8) & 0xf] | PC2[13][(right >> 4) & 0xf];
            temp = ((righttemp >> 16) ^ lefttemp) & 0x0000ffff;
            keys[n++] = lefttemp ^ temp;
            keys[n++] = righttemp ^ (temp << 16);
        }
    }
}

// NICE DES (mode=1 이면 CBC). encrypt=1 이면 암호화
static int nice_des(const unsigned char *key, size_t key_len, const unsigned char *msg, size_t msg_len,
                    int encrypt, int mode, const unsigned char *iv, size_t iv_len, unsigned char **out,
                    size_t *out_len)
{
    uint32_t keys[96];              // 라운드 키
    int nkeys = 0;                  // 라운드 키 개수
    int looping[9];                 // 암호화/복호화 방향
    int iterations;                 // DES / 3DES
    int nloop;                      // looping 길이
    size_t m = 0;                   // 평문 위치
    uint32_t cbcleft = 0, cbcright = 0, cbcleft2 = 0, cbcright2 = 0; // CBC 상태
    unsigned char *result;          // 암호문 버퍼
    size_t rlen = 0;                // 암호문 길이
    size_t ivm = 0;                 // IV 위치

    des_create_keys(key, key_len, keys, &nkeys);
    iterations = (nkeys == 32) ? 3 : 9;
    if (iterations == 3) {
        if (encrypt) {
            looping[0] = 0;
            looping[1] = 32;
            looping[2] = 2;
        } else {
            looping[0] = 30;
            looping[1] = -2;
            looping[2] = -2;
        }
        nloop = 3;
    } else if (encrypt) {
        int v[] = {0, 32, 2, 62, 30, -2, 64, 96, 2};
        memcpy(looping, v, sizeof(v));
        nloop = 9;
    } else {
        int v[] = {94, 62, -2, 32, 64, 2, 30, -2, -2};
        memcpy(looping, v, sizeof(v));
        nloop = 9;
    }

    result = (unsigned char *)sw_xmalloc(msg_len + 16);
    if (mode == 1 && iv) {
        cbcleft = ((uint32_t)bget(iv, iv_len, ivm) << 24) | ((uint32_t)bget(iv, iv_len, ivm + 1) << 16) |
                  ((uint32_t)bget(iv, iv_len, ivm + 2) << 8) | (uint32_t)bget(iv, iv_len, ivm + 3);
        cbcright = ((uint32_t)bget(iv, iv_len, ivm + 4) << 24) | ((uint32_t)bget(iv, iv_len, ivm + 5) << 16) |
                   ((uint32_t)bget(iv, iv_len, ivm + 6) << 8) | (uint32_t)bget(iv, iv_len, ivm + 7);
    }

    // 8바이트씩 잘라 IP → 16라운드 → FP
    while (m < msg_len) {
        uint32_t left, right, temp, right1, right2; // 한 블록
        int j, i;                   // 라운드 인덱스
        left = ((uint32_t)bget(msg, msg_len, m) << 24) | ((uint32_t)bget(msg, msg_len, m + 1) << 16) |
               ((uint32_t)bget(msg, msg_len, m + 2) << 8) | (uint32_t)bget(msg, msg_len, m + 3);
        right = ((uint32_t)bget(msg, msg_len, m + 4) << 24) | ((uint32_t)bget(msg, msg_len, m + 5) << 16) |
                ((uint32_t)bget(msg, msg_len, m + 6) << 8) | (uint32_t)bget(msg, msg_len, m + 7);
        m += 8;

        if (mode == 1) {
            if (encrypt) {
                left ^= cbcleft;
                right ^= cbcright;
            } else {
                cbcleft2 = cbcleft;
                cbcright2 = cbcright;
                cbcleft = left;
                cbcright = right;
            }
        }

        temp = ((left >> 4) ^ right) & 0x0f0f0f0f;
        right ^= temp;
        left ^= (temp << 4);
        temp = ((left >> 16) ^ right) & 0x0000ffff;
        right ^= temp;
        left ^= (temp << 16);
        temp = ((right >> 2) ^ left) & 0x33333333;
        left ^= temp;
        right ^= (temp << 2);
        temp = ((right >> 8) ^ left) & 0x00ff00ff;
        left ^= temp;
        right ^= (temp << 8);
        temp = ((left >> 1) ^ right) & 0x55555555;
        right ^= temp;
        left ^= (temp << 1);
        left = (left << 1) | (left >> 31);
        right = (right << 1) | (right >> 31);

        for (j = 0; j < nloop; j += 3) {
            int endloop = looping[j + 1];
            int loopinc = looping[j + 2];
            for (i = looping[j]; i != endloop; i += loopinc) {
                right1 = right ^ keys[i];
                right2 = ((right >> 4) | (right << 28)) ^ keys[i + 1];
                temp = left;
                left = right;
                right = temp ^ (SP2[(right1 >> 24) & 0x3f] | SP4[(right1 >> 16) & 0x3f] |
                                SP6[(right1 >> 8) & 0x3f] | SP8[right1 & 0x3f] |
                                SP1[(right2 >> 24) & 0x3f] | SP3[(right2 >> 16) & 0x3f] |
                                SP5[(right2 >> 8) & 0x3f] | SP7[right2 & 0x3f]);
            }
            temp = left;
            left = right;
            right = temp;
        }

        left = (left >> 1) | (left << 31);
        right = (right >> 1) | (right << 31);
        temp = ((left >> 1) ^ right) & 0x55555555;
        right ^= temp;
        left ^= (temp << 1);
        temp = ((right >> 8) ^ left) & 0x00ff00ff;
        left ^= temp;
        right ^= (temp << 8);
        temp = ((right >> 2) ^ left) & 0x33333333;
        left ^= temp;
        right ^= (temp << 2);
        temp = ((left >> 16) ^ right) & 0x0000ffff;
        right ^= temp;
        left ^= (temp << 16);
        temp = ((left >> 4) ^ right) & 0x0f0f0f0f;
        right ^= temp;
        left ^= (temp << 4);

        if (mode == 1) {
            if (encrypt) {
                cbcleft = left;
                cbcright = right;
            } else {
                left ^= cbcleft2;
                right ^= cbcright2;
            }
        }
        result[rlen++] = (unsigned char)(left >> 24);
        result[rlen++] = (unsigned char)((left >> 16) & 0xff);
        result[rlen++] = (unsigned char)((left >> 8) & 0xff);
        result[rlen++] = (unsigned char)(left & 0xff);
        result[rlen++] = (unsigned char)(right >> 24);
        result[rlen++] = (unsigned char)((right >> 16) & 0xff);
        result[rlen++] = (unsigned char)((right >> 8) & 0xff);
        result[rlen++] = (unsigned char)(right & 0xff);
    }
    *out = result;
    *out_len = rlen;
    return SW_OK;
}

// 3바이트를 4글자로 바꾼다 (패딩은 KEYSTR[64] = '=')
static int b64_encode(const unsigned char *in, size_t n, char *out, size_t outsz)
{
    size_t i = 0;                   // 입력 위치
    size_t o = 0;                   // 출력 위치
    while (i < n) {
        unsigned int chr1 = in[i++];
        unsigned int chr2 = i < n ? in[i++] : 0x100; /* 0x100 = JS NaN 자리 */
        unsigned int chr3 = i < n ? in[i++] : 0x100;
        unsigned int enc1, enc2, enc3, enc4;
        int missing2 = chr2 == 0x100;
        int missing3 = chr3 == 0x100;
        if (missing2) chr2 = 0;
        if (missing3) chr3 = 0;
        enc1 = chr1 >> 2;
        enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
        enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
        enc4 = chr3 & 63;
        if (missing2) enc3 = enc4 = 64;
        else if (missing3) enc4 = 64;
        if (o + 4 >= outsz) return SW_ERR;
        out[o++] = KEYSTR[enc1];
        out[o++] = KEYSTR[enc2];
        out[o++] = KEYSTR[enc3];
        out[o++] = KEYSTR[enc4];
    }
    out[o] = 0;
    return SW_OK;
}

// 로그인마다 다른 24글자 키를 만든다
static void random_key24(char *out)
{
    int i;                          // 글자 인덱스
    unsigned seed = (unsigned)time(NULL) ^ (unsigned)(uintptr_t)out; // 난수 씨앗
#ifdef _WIN32
    seed ^= (unsigned)GetTickCount();
    seed ^= (unsigned)GetCurrentProcessId();
#endif
    srand(seed);
    for (i = 0; i < 24; i++) out[i] = KEYSTR[(unsigned)rand() % 64];
    out[24] = 0;
}

// key + !#! + DES(평문) 을 Base64 로 만든다
static int make_encrypt_info(const char *plain, const char *key24, char *out, size_t outsz)
{
    unsigned char *cipher = NULL;   // DES 결과
    size_t clen = 0;                // DES 길이
    unsigned char packed[4096];     // 키+구분자+암호문
    size_t plen;                    // packed 길이
    size_t key_len = strlen(key24); // 24
    size_t delim_len = strlen(DELIM);
    size_t plain_len = strlen(plain);

    if (nice_des((const unsigned char *)key24, key_len, (const unsigned char *)plain, plain_len, 1, 1,
                 (const unsigned char *)key24, key_len, &cipher, &clen) != SW_OK) {
        return SW_ERR;
    }
    plen = key_len + delim_len + clen;
    if (plen >= sizeof(packed)) {
        free(cipher);
        return SW_ERR;
    }
    memcpy(packed, key24, key_len);
    memcpy(packed + key_len, DELIM, delim_len);
    memcpy(packed + key_len + delim_len, cipher, clen);
    free(cipher);
    return b64_encode(packed, plen, out, outsz);
}

// 고정 키로 encryptData 만들기 (RETURN: SW_OK)
int sw_make_encrypt_data_with_key(const char *user_id, const char *password, const char *key24,
                                  char *out, size_t outsz)
{
    char enc_id[256];               // URL 인코딩한 학번
    char enc_pw[512];               // URL 인코딩한 비밀번호
    char plain[1024];               // 서버가 받는 평문
    /* TS: makeSendInfo(userId, encodeURIComponent(password), undefined, undefined)
     * undefined 는 문자열 "undefined" 로 붙는다. */
    if (sw_url_encode(user_id ? user_id : "", enc_id, sizeof(enc_id)) != SW_OK) return SW_ERR;
    if (sw_url_encode(password ? password : "", enc_pw, sizeof(enc_pw)) != SW_OK) return SW_ERR;
    snprintf(plain, sizeof(plain), "%s%s%s%sundefined%sundefined", enc_id, DELIM, enc_pw, DELIM, DELIM);
    return make_encrypt_info(plain, key24, out, outsz);
}

// encryptData 만들기 (RETURN: SW_OK)
int sw_make_encrypt_data(const char *user_id, const char *password, char *out, size_t outsz)
{
    char key[32];                   // 이번 로그인용 24글자 키

    random_key24(key);
    return sw_make_encrypt_data_with_key(user_id, password, key, out, outsz);
}
