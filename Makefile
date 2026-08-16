# seowon-cli 루트에서 빌드

CC      ?= gcc
CFLAGS  ?= -std=c11 -Wall -Wextra -O2
INCLUDES = -Ilib -Ilib/front -Ilib/back -Ilib/vendor
DEFS     = -D_CRT_SECURE_NO_WARNINGS -DCJSON_HIDE_SYMBOLS
LIBS     = -lwinhttp
SRC      = main.c test.c \
           lib/util.c \
           lib/front/ui.c lib/front/prompt.c \
           lib/back/fs.c lib/back/http.c lib/back/crypto.c \
           lib/back/parse.c lib/back/data_manager.c \
           lib/vendor/cJSON.c
OUT      = seowon-cli.exe

.PHONY: all test demo clean

all: $(OUT)

$(OUT): $(SRC) lib/seowon.h
	$(CC) $(CFLAGS) $(INCLUDES) $(DEFS) -o $(OUT) $(SRC) $(LIBS)

test: $(OUT)
	./$(OUT) --test

demo: $(OUT)
	./$(OUT) --demo

clean:
	-del /Q $(OUT) 2>nul
	-rm -f $(OUT)
