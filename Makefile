# seowon-cli 루트에서 빌드

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
           lib/c_modules/cJSON.c
OUT      = seowon-tui.exe

GUI_OUT  = seowon-gui.exe

.PHONY: all test demo clean gui

all: $(OUT) $(GUI_OUT)

$(OUT): $(SRC) lib/seowon.h
	$(CC) $(CFLAGS) $(INCLUDES) $(DEFS) -o $(OUT) $(SRC) $(LIBS)

test: $(OUT)
	./$(OUT) --test

demo: $(OUT)
	./$(OUT) --demo

gui: $(GUI_OUT)

$(GUI_OUT): gui_main.c
	$(CC) $(CFLAGS) -o $(GUI_OUT) gui_main.c -luser32

clean:
	-del /Q $(OUT) $(GUI_OUT) 2>nul
	-rm -f $(OUT) $(GUI_OUT)
