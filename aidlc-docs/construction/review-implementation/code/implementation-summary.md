# U3 구현과 인계

ReviewService와 ReviewPanel을 병렬 구현하고, 별도 에이전트가 단위 통합/마이그레이션을 검증했다. 주 에이전트는 공유 저장·HTTP·역할/보드/상세와 수동 완료를 연결했다.

| 계약 | 구현 |
|---|---|
| C06 request/listReviews/getReview/submitResult | src/review-implementation/services/review-service.ts |
| C01 selectRole | src/app/WorkspaceShell.tsx, roles.css; 초안 확인과 시연 모드 |
| C03 markImplemented | 기존 src/sr-document-foundation/services/sr-service.ts |
| C01 리뷰·완료 화면 | src/review-implementation/ui/ReviewPanel.tsx, review-client.ts, review.css |
| C02 리뷰·완료 API | src/review-implementation/http/review-routes.ts와 기존 routes 조립 |
| C09 조회·저장 | 기존 StorePort/Queries/SQLiteStore와 migrations/003-reviews.ts |
| 카드·정확한 문서 조회 | 기존 SRCard/SRDetailPage/DocumentWorkspace, 작성자 편집·리뷰어 비교 |

schema v3는 reviews 및 review_receipts를 추가하고 v1/v2 원문·버전·Run·결정·receipt를 유지한다. 리뷰 원래 대상과 결과를 불변 사건에 연결하며 리뷰가 계획 state를 변경하지 않도록 저장 경계에서도 확인한다.

US-11/12/14와 US-02/05/06/08/09/13의 최종 연결을 검증했다. 운영 배포는 수행하지 않았으며 모든 단위의 결과를 Build and Test에 인계한다. 확장 3개 Disabled/N/A. 사용자 파일과 원래 README 삭제 보존.
