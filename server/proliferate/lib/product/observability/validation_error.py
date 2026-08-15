from proliferate.lib.product.observability.contract import RejectionReasonV1


class DiagnosticsContractErrorV1(ValueError):
    def __init__(self, reason: RejectionReasonV1) -> None:
        super().__init__(reason)
        self.reason = reason
