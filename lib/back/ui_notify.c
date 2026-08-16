// GUI 브랜치: 터미널 메뉴 없이 상태만 찍는다
#include "ui_notify.h"
#include <stdio.h>

void sw_ui_banner(void) {}
void sw_ui_info(const char *msg) { if (msg) fprintf(stderr, "%s\n", msg); }
void sw_ui_ok(const char *msg) { if (msg) fprintf(stderr, "%s\n", msg); }
void sw_ui_warn(const char *msg) { if (msg) fprintf(stderr, "%s\n", msg); }
void sw_ui_err(const char *msg) { if (msg) fprintf(stderr, "%s\n", msg); }
