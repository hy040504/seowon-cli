# seowon-cli GUI

CC      ?= gcc
CFLAGS  ?= -std=c11 -Wall -Wextra -O2
INCLUDES = -Ilib -Ilib/front -Ilib/back -Ilib/c_modules
DEFS     = -D_CRT_SECURE_NO_WARNINGS -DCJSON_HIDE_SYMBOLS
LIBS     = -lwinhttp
CORE_SRC = main.c test.c \
           lib/util.c \
           lib/back/fs.c lib/back/http.c lib/back/crypto.c \
           lib/back/parse.c lib/back/data_manager.c \
           lib/back/ssv.c lib/back/sugang.c lib/back/ui_notify.c \
           lib/c_modules/cJSON.c
CORE_OUT = seowon-core.exe
GUI_OUT  = seowon-gui.exe

.PHONY: all test gui clean

all: $(CORE_OUT) $(GUI_OUT)

$(CORE_OUT): $(CORE_SRC) lib/seowon.h
	$(CC) $(CFLAGS) $(INCLUDES) $(DEFS) -o $(CORE_OUT) $(CORE_SRC) $(LIBS)

$(GUI_OUT): gui_main.c
	$(CC) $(CFLAGS) -o $(GUI_OUT) gui_main.c -luser32

test: $(CORE_OUT)
	./$(CORE_OUT) --test

gui: $(GUI_OUT)

clean:
	-del /Q $(CORE_OUT) $(GUI_OUT) 2>nul
	-rm -f $(CORE_OUT) $(GUI_OUT)
