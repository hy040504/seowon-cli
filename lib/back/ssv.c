// Nexacro SSV — seowon-client-api hope-basket/ssv.ts 와 같은 형식
#include "ssv.h"
#include "../util.h"

static void rs(SwBuf *out) { sw_buf_append(out, "\x1e", 1); }
static void us(SwBuf *out) { sw_buf_append(out, "\x1f", 1); }

int sw_ssv_begin(SwBuf *out)
{
    sw_buf_init(out);
    return sw_buf_append(out, "SSV:utf-8", 9);
}

int sw_ssv_add_param(SwBuf *out, const char *key, const char *value)
{
    rs(out);
    sw_buf_append(out, key, strlen(key));
    sw_buf_append(out, "=", 1);
    return sw_buf_append(out, value ? value : "", strlen(value ? value : ""));
}

int sw_ssv_dataset_begin(SwBuf *out, const char *id, const char **cols, int ncol)
{
    int i;
    rs(out);
    sw_buf_append(out, "Dataset:", 8);
    sw_buf_append(out, id, strlen(id));
    rs(out);
    sw_buf_append(out, "_RowType_", 9);
    for (i = 0; i < ncol; i++) {
        us(out);
        sw_buf_append(out, cols[i], strlen(cols[i]));
        sw_buf_append(out, ":STRING(256)", 12);
    }
    return SW_OK;
}

int sw_ssv_row(SwBuf *out, const char *row_type, const char **cells, int n)
{
    int i;
    rs(out);
    sw_buf_append(out, row_type ? row_type : "N", 1);
    for (i = 0; i < n; i++) {
        us(out);
        if (!cells[i] || !cells[i][0])
            sw_buf_append(out, "\x03", 1);
        else
            sw_buf_append(out, cells[i], strlen(cells[i]));
    }
    return SW_OK;
}

int sw_ssv_dataset_end(SwBuf *out)
{
    rs(out);
    return SW_OK;
}

static int col_index(const char *header, const char *col)
{
    const char *p = header;
    int idx = -1;
    while (p && *p) {
        const char *us_pos, *name_end;
        idx++;
        us_pos = strchr(p, SSV_US);
        name_end = strchr(p, ':');
        if (name_end && (!us_pos || name_end < us_pos)) {
            size_t n = (size_t)(name_end - p);
            if (n == strlen(col) && strncmp(p, col, n) == 0) return idx;
        } else if (strncmp(p, col, strlen(col)) == 0) {
            char next = p[strlen(col)];
            if (next == 0 || next == SSV_US) return idx;
        }
        p = us_pos ? us_pos + 1 : NULL;
    }
    return -1;
}

int sw_ssv_field(const char *body, const char *dataset, const char *col, char *out, size_t outsz)
{
    char mark[128];
    const char *ds, *hdr, *row, *rs1, *cell;
    int want, i;

    if (!out || outsz == 0) return SW_ERR;
    out[0] = 0;
    if (!body || !dataset || !col) return SW_ERR_PARSE;
    snprintf(mark, sizeof(mark), "Dataset:%s", dataset);
    ds = strstr(body, mark);
    if (!ds) return SW_ERR_PARSE;
    hdr = strchr(ds, SSV_RS);
    if (!hdr) return SW_ERR_PARSE;
    hdr++;
    want = col_index(hdr, col);
    if (want < 0) return SW_ERR_PARSE;
    row = strchr(hdr, SSV_RS);
    if (!row) return SW_ERR_PARSE;
    row++;
    if (strncmp(row, "Dataset:", 8) == 0 || *row == 0) return SW_ERR_PARSE;
    cell = row;
    for (i = 0; i < want; i++) {
        const char *u = strchr(cell, SSV_US);
        if (!u) return SW_ERR_PARSE;
        cell = u + 1;
    }
    rs1 = strchr(cell, SSV_RS);
    {
        const char *u = strchr(cell, SSV_US);
        const char *end = cell + strlen(cell);
        if (u && (!rs1 || u < rs1)) end = u;
        else if (rs1) end = rs1;
        if (end > cell && cell[0] == SSV_EMPTY && end == cell + 1) {
            out[0] = 0;
            return SW_OK;
        }
        if ((size_t)(end - cell) >= outsz) {
            memcpy(out, cell, outsz - 1);
            out[outsz - 1] = 0;
        } else {
            memcpy(out, cell, (size_t)(end - cell));
            out[end - cell] = 0;
        }
    }
    return SW_OK;
}
