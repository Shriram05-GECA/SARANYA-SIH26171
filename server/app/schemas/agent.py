from typing import Literal, Optional
from pydantic import BaseModel, Field

ElementType = Literal["button", "link", "input", "select", "checkbox", "radio", "heading", "text", "image"]


class PageElement(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_\-#]+$")
    type: ElementType
    text: Optional[str] = Field(default=None, max_length=400)
    content: Optional[str] = Field(default=None, max_length=400)
    label: Optional[str] = Field(default=None, max_length=200)
    placeholder: Optional[str] = Field(default=None, max_length=200)
    input_type: Optional[str] = Field(default=None, max_length=30)
    value: Optional[str] = Field(default=None, max_length=400)
    has_value: Optional[bool] = None
    checked: Optional[bool] = None
    options: Optional[list[str]] = Field(default=None, max_length=50)
    href_path: Optional[str] = Field(default=None, max_length=300)
    disabled: Optional[bool] = None
    sensitive: Optional[bool] = None
    in_viewport: Optional[bool] = None
    alt: Optional[str] = Field(default=None, max_length=300)
    ocr_text: Optional[str] = Field(default=None, max_length=1200)
    ocr_status: Optional[str] = Field(default=None, max_length=20)
    ocr_regions_redacted: Optional[int] = None
    flags: Optional[list[str]] = Field(default=None, max_length=10)


class ScrollInfo(BaseModel):
    y: int = 0
    max_y: int = 0
    viewport_h: int = 0


class PageContext(BaseModel):
    title: str = Field(default="", max_length=300)
    url: str = Field(default="", max_length=500)
    page_type: str = Field(default="generic", max_length=40)
    demo_site: bool = False
    scroll: Optional[ScrollInfo] = None
    elements: list[PageElement] = Field(default_factory=list, max_length=400)


class VisualDetection(BaseModel):
    label: str = Field(max_length=40)
    confidence: float = Field(ge=0, le=1)
    bbox: dict = Field(default_factory=dict)


class VisualContext(BaseModel):
    """Sanitized local CV output — never includes pixels or raw secrets."""
    used: bool = False
    backend: str = Field(default="unavailable", max_length=20)
    model: Optional[str] = Field(default=None, max_length=80)
    model_size_mb: Optional[float] = None
    inference_ms: Optional[float] = None
    detections: list[VisualDetection] = Field(default_factory=list, max_length=20)
    scene_summary: Optional[str] = Field(default=None, max_length=500)
    trace: Optional[dict] = None


class AgentRequest(BaseModel):
    task: str = Field(min_length=1, max_length=500)
    page: PageContext
    visual: Optional[VisualContext] = None


ActionName = Literal["click", "scroll", "type", "select", "navigate", "none"]


class AgentAction(BaseModel):
    action: ActionName
    element_id: Optional[str] = Field(default=None, max_length=80, pattern=r"^[A-Za-z0-9_\-#]+$")
    direction: Optional[Literal["up", "down", "top", "bottom"]] = None
    amount: Optional[int] = Field(default=None, ge=1, le=5000)
    text: Optional[str] = Field(default=None, max_length=200)
    value: Optional[str] = Field(default=None, max_length=200)
    url: Optional[str] = Field(default=None, max_length=500)
    confidence: float = Field(default=0.5, ge=0, le=1)
    reason: str = Field(default="", max_length=400)


class AgentResponse(AgentAction):
    provider: str = ""
    server_ms: float = 0.0
