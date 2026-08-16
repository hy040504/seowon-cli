# seowon-cli TUI

CC      ?= gcc
CFLAGS  ?= -std=c11 -Wall -Wextra -O2
INCLUDES = -Ilib -Ilib/front -Ilib/front/tui -Ilib/back -Ilib/c_modules
DEFS     = -D_CRT_SECURE_NO_WARNINGS -DCJSON_HIDE_SYMBOLS
LIBS     = -lwinhttp
SRC      = main.c test.c \
           lib/util.c \
           lib/front/tui/ui.c lib/front/tui/prompt.c \
           lib/back/fs.c lib/back/http.c lib/back/crypto.c \
           lib/back/parse.c lib/back/data_manager.c \
           lib/back/ssv.c lib/back/sugang.c \
           lib/c_modules/cJSON.c
OUT      = seowon-tui.exe

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
