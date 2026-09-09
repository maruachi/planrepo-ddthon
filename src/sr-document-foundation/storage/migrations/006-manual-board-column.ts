export const manualBoardColumnSQL = `
ALTER TABLE srs ADD COLUMN manual_board_column TEXT
 CHECK(manual_board_column IS NULL OR manual_board_column IN ('sr_list','requirements_analysis','inception','construction','peer_review','implementation_ready','implemented'));
`;
