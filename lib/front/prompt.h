#ifndef SW_FRONT_PROMPT_H
#define SW_FRONT_PROMPT_H

// 커스텀 라이브러리
#include "../seowon.h"

// 메뉴 이동 값
#define SW_MENU_OK 0        // 계속
#define SW_MENU_BACK 1      // 뒤로가기 (z)
#define SW_MENU_QUIT 2      // 종료 (q)

// 메뉴 함수 (RETURN: SW_OK)
int sw_app_run_menu(SwApp *app);            // 0: 메인 메뉴 루프

#endif
