export {
  requestIdMiddleware as correlationIdMiddleware,
  requestIdMiddleware,
  createRequestIdMiddleware,
  isValidRequestId,
  isTrustedGatewayRequest,
  requireGatewayOrigin,
  createRequireGatewayOrigin,
  REQUEST_ID_HEADER,
  CORRELATION_ID_HEADER,
  TRACE_ID_HEADER,
  SAFE_REQUEST_ID_REGEX,
} from "./request-id.middleware";
