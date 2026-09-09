# PLAN — eSPEC 첨부파일 업로드 오류 조회/재처리 기능

## 1. 목적

eSPEC 문서(PRC/INS) 첨부파일 중 `USE_YN = 'Y'` 이지만 `FILE_UPLOAD_DTTM`이 없는 비정상 건을 운영자가 직접 조회하고 재처리할 수 있도록 기능을 추가한다.\
현재는 DB 조회 및 수동 확인이 필요하므로, Portal에서 대상 문서와 첨부파일 상태를 확인하고 재처리 결과까지 추적 가능하도록 개선한다.

## 2. 변경 범위

- **Frontend**: `dks-espec-portal` / Vue.js
- **Backend**: `dks-espec-endpoint` / Spring Boot
- **DB**: Oracle (`RPT_DOC`, `ESPEC_ATTACH_FILE`)
- **제외 범위**: 파일 저장소 구조 변경, 기존 정상 첨부파일 이관, 인증/권한 체계 변경

## 3. 사용자 흐름

`문서번호/기간 검색` → `업로드 오류 첨부파일 조회` → `대상 선택` → `재처리 요청` → `성공/실패 결과 표시`

- 조회 조건: `RPT_DOC_ID`, 등록일자, 문서구분(PRC/INS)
- 오류 판정: `ESPEC_ATTACH_FILE.USE_YN = 'Y' AND FILE_UPLOAD_DTTM IS NULL`
- 문서별 첨부파일이 여러 건인 경우 **1건이라도 오류이면 문서 단위로 노출**
- 재처리 성공 후 목록에서 즉시 상태 갱신

## 4. Backend / API

### GET `/api/attachments/upload-errors`

**입력**

- `rptDocId?`
- `fromDate?`
- `toDate?`
- `docType?` (`PRC` / `INS`)

**처리**

1. `RPT_DOC` 대상 문서 조회
2. `ESPEC_ATTACH_FILE` 조인
3. 활성 첨부파일 중 `FILE_UPLOAD_DTTM IS NULL` 존재 여부 확인
4. 문서번호 기준으로 오류 파일 수와 상세 반환

**응답 예시**
```json
{
  "rptDocId": "INS00649-019",
  "errorFileCount": 2,
  "files": [
    { "fileId": "12345", "fileName": "spec.xlsx", "uploadDttm": null }
  ]
}
```

### POST `/api/attachments/{fileId}/retry`

- 기존 파일 업로드 Service 로직 재사용
- 성공 시 `FILE_UPLOAD_DTTM` 갱신
- 실패 시 원인 로그 기록 및 오류 메시지 반환
- 중복 요청 방지를 위해 현재 상태 재확인 후 처리

## 5. DB / Query
```sql
SELECT
    R.RPT_DOC_ID,
    COUNT(*) AS ERROR_FILE_COUNT
FROM RPT_DOC R
JOIN ESPEC_ATTACH_FILE A
  ON A.MAPPING_1ST_KEY_ID = R.RPT_DOC_ID
WHERE A.USE_YN = 'Y'
  AND A.FILE_UPLOAD_DTTM IS NULL
  AND (R.RPT_DOC_ID LIKE 'PRC%' OR R.RPT_DOC_ID LIKE 'INS%')
GROUP BY R.RPT_DOC_ID;
```

- 신규 테이블 생성 없음
- 기존 인덱스 확인: `ESPEC_ATTACH_FILE(MAPPING_1ST_KEY_ID)`
- 조회 성능 문제 시 `USE_YN`, `FILE_UPLOAD_DTTM` 조건 포함 인덱스 검토

## 6. Frontend

- 운영 메뉴에 **첨부파일 업로드 오류** 화면 추가
- 검색영역: 문서번호 / 기간 / 문서구분
- Grid: 문서번호, 오류 파일 수, 파일명, 상태, 재처리 버튼
- 재처리 전 Confirm 표시
- 처리 중 버튼 비활성화
- 성공: 해당 Row 재조회
- 실패: 서버 오류 메시지 표시

## 7. Risk / 대응방안

| Risk영향대응방안                           |                       |                                                           |
| ------------------------------------ | --------------------- | --------------------------------------------------------- |
| 동일 파일 재처리로 인한 **중복 업로드**             | 파일 중복 저장 또는 상태 불일치    | 재처리 직전 `FILE_UPLOAD_DTTM` 재확인, 이미 정상 처리된 건은 Skip          |
| 재처리 중 일부 단계만 성공하는 **부분 실패**          | 파일 저장소와 DB 상태 불일치     | 기존 업로드 Service의 트랜잭션 경계 확인, 실패 시 DB 상태를 정상적으로 Rollback/보정 |
| 오류 건 대량 조회 시 **Oracle 부하 증가**        | 운영 DB 응답 지연           | 조회 기간 제한, Pagination 적용, 실행계획 및 인덱스 확인                    |
| 원본 파일이 이미 삭제되었거나 접근 불가               | 재처리 자체가 불가능           | 재처리 전 원본 존재 여부 확인 후 사용자에게 명확한 실패 사유 반환                    |
| 운영자 외 사용자의 재처리 API 호출                | 비정상 데이터 변경 가능         | 기존 eSPEC 권한 체계를 사용하여 운영 권한 사용자만 재처리 허용                    |
| 기존 첨부파일 업로드 로직 변경에 따른 **Regression** | 정상 PRC/INS 첨부파일 처리 영향 | 신규 로직 구현보다 기존 Service 재사용 우선, 기존 등록/업로드 시나리오 회귀 테스트 수행    |
| 동일 파일에 대한 동시 재처리 요청                  | Race condition, 중복 처리 | 처리 전 상태 재검증 및 필요 시 DB Lock/처리 상태값 적용 검토                   |

**주요 확인 필요사항**

- 기존 파일 업로드 Service가 재호출 가능한 구조인지 확인
- 실제 원본 파일의 보관 위치 및 재처리 시 접근 가능 여부 확인
- `ESPEC_ATTACH_FILE` 대량 데이터 기준 실행계획 확인

## 8. 테스트

- 정상 파일만 존재하는 문서는 조회되지 않아야 함
- 동일 `RPT_DOC_ID`에 정상/오류 파일이 섞여 있으면 문서는 조회되어야 함
- `USE_YN = 'N'` 파일은 오류 판정에서 제외
- 재처리 성공 시 `FILE_UPLOAD_DTTM`이 생성되어야 함
- 이미 처리된 파일에 재요청 시 중복 업로드되지 않아야 함
- PRC / INS 각각 조회 검증
- 대량 조회 시 응답시간 및 Oracle 실행계획 확인

## 9. 예상 변경 파일
```bash
dks-espec-portal
└─ src/views/.../AttachmentUploadError.vue
└─ src/api/attachment.ts

dks-espec-endpoint
└─ controller/AttachmentController.java
└─ service/AttachmentService.java
└─ repository/AttachmentRepository.java
└─ dto/AttachmentUploadErrorDto.java

Oracle
└─ 기존 RPT_DOC / ESPEC_ATTACH_FILE 조회
```

