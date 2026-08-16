#ifndef SW_BACK_UI_NOTIFY_H
#define SW_BACK_UI_NOTIFY_H

// GUI 브랜치용 로그. TUI 메뉴는 없다.
void sw_ui_banner(void);
void sw_ui_info(const char *msg);
void sw_ui_ok(const char *msg);
void sw_ui_warn(const char *msg);
void sw_ui_err(const char *msg);

#endif
