///<reference path="../../../_references.ts"/>

module powerbi.visuals.samples {
    import SelectionManager = utility.SelectionManager;
    import ClassAndSelector = jsCommon.CssConstants.ClassAndSelector;
    import createClassAndSelector = jsCommon.CssConstants.createClassAndSelector;
    import PixelConverter = jsCommon.PixelConverter;

    export interface ITreeView {
        data(data: any[], dataIdFunction: (d) => {}, dataAppended: boolean): ITreeView;
        rowHeight(rowHeight: number): ITreeView;
        viewport(viewport: IViewport): ITreeView;
        render(): void;
        empty(): void;
    }

    export module TreeViewFactory {
        export function createListView(options): ITreeView {
            return new TreeView(options);
        }
    }

    /**
     * A UI Virtualized List, that uses the D3 Enter, Update & Exit pattern to update rows.
     * It can create lists containing either HTML or SVG elements.
     */
    class TreeView implements ITreeView {
        private getDatumIndex: (d: any) => {};
        private _data: any[];
        private _totalRows: number;

        private options: ListViewOptions;
        private visibleGroupContainer: D3.Selection;
        private scrollContainer: D3.Selection;
        private scrollbarInner: D3.Selection;
        private renderTimeoutId: number;

        /**
         * The value indicates the percentage of data already shown
         * in the list view that triggers a loadMoreData call.
         */
        private static loadMoreDataThreshold = 0.8;
        private static defaultRowHeight = 1;

        public constructor(options: ListViewOptions) {
            // make a copy of options so that it is not modified later by caller
            this.options = $.extend(true, {}, options);

            this.scrollbarInner = options.baseContainer
                .append('div')
                .classed('scrollbar-inner', true)
                .on('scroll', () => this.renderImpl(this.options.rowHeight));

            this.scrollContainer = this.scrollbarInner
                .append('div')
                .classed('scrollRegion', true);

            this.visibleGroupContainer = this.scrollContainer
                .append('div')
                .classed('visibleGroup', true);

            var scrollInner = $(this.scrollbarInner.node());
            scrollInner.scrollbar({
                ignoreOverlay: false,
                ignoreMobile: false,
                onDestroy: function () { return scrollInner.off('scroll'); },
            });

            $(options.baseContainer.node()).find('.scroll-element').attr('drag-resize-disabled', 'true');

            TreeView.SetDefaultOptions(options);
        }

        private static SetDefaultOptions(options: ListViewOptions) {
            options.rowHeight = options.rowHeight || TreeView.defaultRowHeight;
        }

        public rowHeight(rowHeight: number): TreeView {
            this.options.rowHeight = Math.ceil(rowHeight) + 2; // Margin top/bottom
            return this;
        }

        public data(data: any[], getDatumIndex: (d) => {}, dataReset: boolean = false): ITreeView {
            this._data = data;
            this.getDatumIndex = getDatumIndex;
            this.setTotalRows();
            if (dataReset)
                $(this.scrollbarInner.node()).scrollTop(0);

            this.render();
            return this;
        }

        public viewport(viewport: IViewport): ITreeView {
            this.options.viewport = viewport;
            this.render();
            return this;
        }

        public empty(): void {
            this._data = [];
            this.render();
        }

        public render(): void {
            if (this.renderTimeoutId)
                window.clearTimeout(this.renderTimeoutId);

            this.renderTimeoutId = window.setTimeout(() => {
                this.renderImpl(this.options.rowHeight);
                this.renderTimeoutId = undefined;
            }, 0);
        }

        private renderImpl(rowHeight: number): void {
            var totalHeight = this.options.scrollEnabled ? Math.max(0, (this._totalRows * rowHeight)) : this.options.viewport.height;
            this.scrollContainer
                .style('height', totalHeight + "px")
                .attr('height', totalHeight);

            this.scrollToFrame(true /*loadMoreData*/);
        }

        private scrollToFrame(loadMoreData: boolean): void {
            var options = this.options;
            var visibleGroupContainer = this.visibleGroupContainer;
            var totalRows = this._totalRows;
            var rowHeight = options.rowHeight || TreeView.defaultRowHeight;
            var visibleRows = this.getVisibleRows() || 1;
            var scrollTop: number = this.scrollbarInner.node().scrollTop;
            var scrollPosition = (scrollTop === 0) ? 0 : Math.floor(scrollTop / rowHeight);
            var transformAttr = SVGUtil.translateWithPixels(0, scrollPosition * rowHeight);

            visibleGroupContainer.style({
                //order matters for proper overriding
                'transform': d => transformAttr,
                '-webkit-transform': transformAttr
            });

            var position0 = Math.max(0, Math.min(scrollPosition, totalRows - visibleRows + 1)),
                position1 = position0 + visibleRows;

            if (this.options.scrollEnabled) {

                // Subtract the amount of height of the top row that's hidden when it's partially visible.
                var topRowHiddenHeight = scrollTop - (scrollPosition * rowHeight);
                var halfRowHeight = rowHeight * 0.5;

                // If more than half the top row is hidden, we'll need to render an extra item at the bottom
                if (topRowHiddenHeight > halfRowHeight) {
                    position1++;  // Add 1 to handle when rows are partially visible (when scrolling)
                }
            }

            var rowSelection = visibleGroupContainer.selectAll(".row")
                .data(this._data.slice(position0, Math.min(position1, totalRows)), this.getDatumIndex);

            rowSelection
                .enter()
                .append('div')
                .classed('row', true)
                .call(d => options.enter(d));
            rowSelection.order();

            var rowUpdateSelection = visibleGroupContainer.selectAll('.row:not(.transitioning)');

            rowUpdateSelection.call(d => options.update(d));

            rowSelection
                .exit()
                .call(d => options.exit(d))
                .remove();

            if (loadMoreData && visibleRows !== totalRows && position1 >= totalRows * TreeView.loadMoreDataThreshold)
                options.loadMoreData();
        }

        private setTotalRows(): void {
            var data = this._data;
            this._totalRows = data ? data.length : 0;
        }

        private getVisibleRows(): number {
            var minimumVisibleRows = 1;
            var rowHeight = this.options.rowHeight;
            var viewportHeight = this.options.viewport.height;

            if (!rowHeight || rowHeight < 1)
                return minimumVisibleRows;

            if (this.options.scrollEnabled)
                return Math.min(Math.ceil(viewportHeight / rowHeight), this._totalRows) || minimumVisibleRows;

            return Math.min(Math.floor(viewportHeight / rowHeight), this._totalRows) || minimumVisibleRows;
        }
    }

    export class HierarchySlicerWebBehavior implements IInteractiveBehavior {
        private hostServices: IVisualHostServices;
        private expanders: D3.Selection;
        private options: HierarchySlicerBehaviorOptions;
        private slicers: D3.Selection;
        private slicerItemLabels: D3.Selection;
        private slicerItemInputs: D3.Selection;
        private dataPoints: HierarchySlicerDataPoint[];
        private interactivityService: IInteractivityService;
        private selectionHandler: ISelectionHandler;
        private settings: HierarchySlicerSettings;
        private levels: number;
        private initFilter: boolean = true;

        public bindEvents(options: HierarchySlicerBehaviorOptions, selectionHandler: ISelectionHandler): void {
            var expanders = this.expanders = options.expanders;
            var slicers = this.slicers = options.slicerItemContainers;
            this.slicerItemLabels = options.slicerItemLabels;
            this.slicerItemInputs = options.slicerItemInputs;
            this.dataPoints = options.dataPoints;
            this.interactivityService = options.interactivityService;
            this.selectionHandler = selectionHandler;
            this.settings = options.slicerSettings;
            this.hostServices = options.hostServices;
            this.levels = options.levels;
            this.options = options;

            var slicerClear = options.slicerClear;
            var slicerExpand = options.slicerExpand;
            var slicerCollapse = options.slicerCollapse;

            if ((this.dataPoints.filter((d) => d.selected).length > 0) && this.initFilter) {
                this.initFilter = false;
                this.applyFilter();
            }

            expanders.on("click", (d: HierarchySlicerDataPoint, i: number) => {
                d.isExpand = !d.isExpand;
                var currentExpander = expanders.filter((e, l) => i === l);
                $(currentExpander[0][0].firstChild).remove(); // remove expand/collapse icon
                var spinner = currentExpander
                    .append("div")
                    .classed("xsmall", true)
                    .classed("powerbi-spinner", true)
                    .style({
                        'margin': '0px;',
                        'padding-left': '5px;',
                        'display': 'block;',
                    })
                    .attr("ng-if", "viewModel.showProgressBar")
                    .attr("delay", "500")
                    .append("div")
                    .classed("spinner", true);

                for (var i = 0; i < 5; i++) {
                    spinner.append("div")
                        .classed("circle", true);
                }

                this.persistExpand(false);
            });

            slicerCollapse.on("click", (d: HierarchySlicerDataPoint) => {
                this.dataPoints.filter((d) => !d.isLeaf).forEach((d) => d.isExpand = false);
                this.persistExpand(true);
            });

            slicerExpand.on("click", (d: HierarchySlicerDataPoint) => {
                this.dataPoints.filter((d) => !d.isLeaf).forEach((d) => d.isExpand = true);
                this.persistExpand(true);
            });

            options.slicerContainer.classed('hasSelection', true);

            slicers.on("mouseover", (d: HierarchySlicerDataPoint) => {
                if (d.selectable) {
                    d.mouseOver = true;
                    d.mouseOut = false;
                    this.renderMouseover();
                }
            });

            slicers.on("mouseout", (d: HierarchySlicerDataPoint) => {
                if (d.selectable) {
                    d.mouseOver = false;
                    d.mouseOut = true;
                    this.renderMouseover();
                }
            });

            slicers.on("click", (d: HierarchySlicerDataPoint, index) => {
                if (!d.selectable) {
                    return;
                }
                var settings: HierarchySlicerSettings = this.settings;
                d3.event.preventDefault();
                if (!settings.general.singleselect) { // multi select value
                    var selected = d.selected;
                    d.selected = !selected; // Toggle selection
                    if (!selected || !d.isLeaf) {
                        var selectDataPoints = this.dataPoints.filter((dp) => dp.parentId.indexOf(d.ownId) >= 0);
                        for (var i = 0; i < selectDataPoints.length; i++) {
                            if (selected === selectDataPoints[i].selected) {
                                selectDataPoints[i].selected = !selected;
                            }
                        }
                        selectDataPoints = this.getParentDataPoints(this.dataPoints, d.parentId);
                        for (var i = 0; i < selectDataPoints.length; i++) {
                            if (!selected && !selectDataPoints[i].selected) {
                                selectDataPoints[i].selected = !selected;
                            } else if (selected && (this.dataPoints.filter((dp) => dp.selected && dp.level === d.level && dp.parentId === d.parentId).length === 0)) {
                                selectDataPoints[i].selected = !selected;
                            }
                        }
                    }
                    if (d.isLeaf) {
                        if (this.dataPoints.filter((d) => d.selected && d.isLeaf).length === 0) { // Last leaf disabled
                            this.dataPoints.map((d) => d.selected = false); // Clear selection
                        }
                    }
                }
                else { // single select value
                    var selected = d.selected;
                    this.dataPoints.map((d) => d.selected = false); // Clear selection
                    if (!selected) {
                        var selectDataPoints = [d]; //Self
                        selectDataPoints = selectDataPoints.concat(this.dataPoints.filter((dp) => dp.parentId.indexOf(d.ownId) >= 0)); // Children
                        selectDataPoints = selectDataPoints.concat(this.getParentDataPoints(this.dataPoints, d.parentId)); // Parents
                        if (selectDataPoints) {
                            for (var i = 0; i < selectDataPoints.length; i++) {
                                selectDataPoints[i].selected = true;
                            }
                        }
                    }
                }

                this.applyFilter();
            });

            slicerClear.on("click", (d: HierarchySlicerDataPoint) => {
                this.selectionHandler.handleClearSelection();
                this.persistFilter(null);
            });
        }

        private renderMouseover(): void {
            this.slicerItemLabels.style({
                'color': (d: HierarchySlicerDataPoint) => {
                    if (d.mouseOver)
                        return this.settings.slicerText.hoverColor;
                    else if (d.mouseOut) {
                        if (d.selected)
                            return this.settings.slicerText.selectedColor;
                        else
                            return this.settings.slicerText.fontColor;
                    }
                    else
                        if (d.selected) //fallback
                            return this.settings.slicerText.selectedColor;
                        else
                            return this.settings.slicerText.fontColor;
                }
            });
            this.slicerItemInputs.select('span').style({
                'background-color': (d: HierarchySlicerDataPoint) => {
                    if (d.mouseOver)
                        return null;
                    else if (d.mouseOut) {
                        if (d.selected)
                            return this.settings.slicerText.selectedColor;
                        else
                            return null;
                    }
                    else
                        if (d.selected) //fallback
                            return this.settings.slicerText.selectedColor;
                        else
                            return null;
                }
            });
        }

        public renderSelection(hasSelection: boolean): void {
            if (!hasSelection && !this.interactivityService.isSelectionModeInverted()) {
                this.slicerItemInputs.filter('.selected').classed('selected', false);
                this.slicerItemInputs.filter('.partiallySelected').classed('partiallySelected', false);
                var input = this.slicerItemInputs.selectAll('input');
                if (input) {
                    input.property('checked', false);
                }
            }
            else {
                this.styleSlicerInputs(this.slicers, hasSelection);
            }
        }

        public styleSlicerInputs(slicers: D3.Selection, hasSelection: boolean) {
            slicers.each(function (d: HierarchySlicerDataPoint) {
                var slicerItem: HTMLElement = this.getElementsByTagName('div')[0];
                var shouldCheck: boolean = d.selected;
                var partialCheck: boolean = false;
                var input = slicerItem.getElementsByTagName('input')[0];
                if (input)
                    input.checked = shouldCheck;

                if (shouldCheck && partialCheck)
                    slicerItem.classList.add('partiallySelected');
                else if (shouldCheck && (!partialCheck))
                    slicerItem.classList.add('selected');
                else
                    slicerItem.classList.remove('selected');
            });
        }

        public applyFilter() {
            if (this.dataPoints.length === 0) { // Called without data
                return;
            }
            var selectNrValues: number = 0
            var filter: powerbi.data.SemanticFilter;
            var rootLevels = this.dataPoints.filter((d) => d.level === 0 && d.selected);

            if (!rootLevels || (rootLevels.length === 0)) {
                this.selectionHandler.handleClearSelection();
                this.persistFilter(null);
            }
            else {
                selectNrValues++;
                var children = this.getChildFilters(this.dataPoints, rootLevels[0].ownId, 1);
                var rootFilters = [];
                if (children) {
                    rootFilters.push(powerbi.data.SQExprBuilder.and(rootLevels[0].id, children.filters));
                    selectNrValues += children.memberCount;
                } else {
                    rootFilters.push(rootLevels[0].id);
                }

                if (rootLevels.length > 1) {
                    for (var i = 1; i < rootLevels.length; i++) {
                        selectNrValues++;
                        children = this.getChildFilters(this.dataPoints, rootLevels[i].ownId, 1);
                        if (children) {
                            rootFilters.push(powerbi.data.SQExprBuilder.and(rootLevels[i].id, children.filters));
                            selectNrValues += children.memberCount;
                        } else {
                            rootFilters.push(rootLevels[i].id);
                        }
                    }
                }

                var rootFilter: powerbi.data.SQExpr = rootFilters[0];
                for (var i = 1; i < rootFilters.length; i++) {
                    rootFilter = powerbi.data.SQExprBuilder.or(rootFilter, rootFilters[i]);
                }

                if (selectNrValues > 120) {

                }

                filter = powerbi.data.SemanticFilter.fromSQExpr(rootFilter);
                this.persistFilter(filter);
            }
        }

        private getParentDataPoints(dataPoints: HierarchySlicerDataPoint[], parentId: string): HierarchySlicerDataPoint[] {
            var parent = dataPoints.filter((d) => d.ownId === parentId);
            if (!parent || (parent.length === 0)) {
                return [];
            } else if (parent[0].level === 0) {
                return parent;
            } else {
                var returnParents = [];

                returnParents = returnParents.concat(parent, this.getParentDataPoints(dataPoints, parent[0].parentId));

                return returnParents;
            }
        }

        private getChildFilters(dataPoints: HierarchySlicerDataPoint[], parentId: string, level: number): { filters: data.SQExpr; memberCount: number; } {
            var memberCount: number = 0;
            var childFilters = dataPoints.filter((d) => d.level === level && d.parentId === parentId && d.selected);
            var totalChildren = dataPoints.filter((d) => d.level === level && d.parentId === parentId).length;
            if (!childFilters || (childFilters.length === 0)) {
                return;
            }
            else if (childFilters[0].isLeaf) { // Leaf level
                if (totalChildren !== childFilters.length) {
                    var returnFilter = childFilters[0].id;
                    memberCount += childFilters.length;
                    if (childFilters.length > 1) {
                        for (var i = 1; i < childFilters.length; i++) {
                            returnFilter = data.SQExprBuilder.or(returnFilter, childFilters[i].id);
                        }
                    }
                    return {
                        filters: returnFilter,
                        memberCount: memberCount,
                    };
                } else {
                    return;
                }
            } else {
                var returnFilter: data.SQExpr;
                var allSelected = (totalChildren === childFilters.length);
                memberCount += childFilters.length;
                for (var i = 0; i < childFilters.length; i++) {
                    var childChildFilter = this.getChildFilters(dataPoints, childFilters[i].ownId, level + 1);
                    if (childChildFilter) {
                        allSelected = false;
                        memberCount += childChildFilter.memberCount;
                        if (returnFilter) {
                            returnFilter = data.SQExprBuilder.or(returnFilter,
                                data.SQExprBuilder.and(childFilters[i].id,
                                    childChildFilter.filters));
                        } else {
                            returnFilter = data.SQExprBuilder.and(childFilters[i].id, childChildFilter.filters);
                        }
                    } else {
                        if (returnFilter) {
                            returnFilter = data.SQExprBuilder.or(returnFilter, childFilters[i].id);
                        } else {
                            returnFilter = childFilters[i].id;
                        }
                    }
                }
                return allSelected ? undefined : {
                    filters: returnFilter,
                    memberCount: memberCount,
                };
            }
        }

        private persistFilter(filter: powerbi.data.SemanticFilter) {
            var properties: { [propertyName: string]: DataViewPropertyValue } = {};
            if (filter) {
                properties[hierarchySlicerProperties.filterPropertyIdentifier.propertyName] = filter;
            } else {
                properties[hierarchySlicerProperties.filterPropertyIdentifier.propertyName] = "";
            }
            var filterValues = this.dataPoints.filter((d) => d.selected).map((d) => d.ownId).join(',');
            if (filterValues) {
                properties[hierarchySlicerProperties.filterValuePropertyIdentifier.propertyName] = filterValues;
            } else {
                properties[hierarchySlicerProperties.filterValuePropertyIdentifier.propertyName] = "";
            }

            var objects: VisualObjectInstancesToPersist = {
                merge: [
                    <VisualObjectInstance>{
                        objectName: hierarchySlicerProperties.filterPropertyIdentifier.objectName,
                        selector: undefined,
                        properties: properties,
                    }]
            };

            this.hostServices.persistProperties(objects);
            this.hostServices.onSelect({ data: [] });
        }

        private persistExpand(updateScrollbar: boolean) {
            var properties: { [propertyName: string]: DataViewPropertyValue } = {};
            properties[hierarchySlicerProperties.expandedValuePropertyIdentifier.propertyName] = this.dataPoints.filter((d) => d.isExpand).map((d) => d.ownId).join(',');

            var objects: VisualObjectInstancesToPersist = {
                merge: [
                    <VisualObjectInstance>{
                        objectName: hierarchySlicerProperties.expandedValuePropertyIdentifier.objectName,
                        selector: undefined,
                        properties: properties,
                    }]
            };

            this.hostServices.persistProperties(objects);
            this.hostServices.onSelect({ data: [] });
        }
    }

    export var hierarchySlicerProperties = {
        selection: {
            singleselect: <DataViewObjectPropertyIdentifier>{ objectName: 'selection', propertyName: 'singleSelect' },
        },
        header: {
            show: <DataViewObjectPropertyIdentifier>{ objectName: 'header', propertyName: 'show' },
            title: <DataViewObjectPropertyIdentifier>{ objectName: 'header', propertyName: 'title' },
            fontColor: <DataViewObjectPropertyIdentifier>{ objectName: 'header', propertyName: 'fontColor' },
            background: <DataViewObjectPropertyIdentifier>{ objectName: 'header', propertyName: 'background' },
            textSize: <DataViewObjectPropertyIdentifier>{ objectName: 'header', propertyName: 'textSize' },
        },
        items: {
            fontColor: <DataViewObjectPropertyIdentifier>{ objectName: 'items', propertyName: 'fontColor' },
            selectedColor: <DataViewObjectPropertyIdentifier>{ objectName: 'items', propertyName: 'selectedColor' },
            background: <DataViewObjectPropertyIdentifier>{ objectName: 'items', propertyName: 'background' },
            textSize: <DataViewObjectPropertyIdentifier>{ objectName: 'items', propertyName: 'textSize' },
        },
        selectedPropertyIdentifier: <DataViewObjectPropertyIdentifier>{ objectName: 'general', propertyName: 'selected' },
        expandedValuePropertyIdentifier: <DataViewObjectPropertyIdentifier>{ objectName: 'general', propertyName: 'expanded' },
        filterPropertyIdentifier: <DataViewObjectPropertyIdentifier>{ objectName: 'general', propertyName: 'filter' },
        filterValuePropertyIdentifier: <DataViewObjectPropertyIdentifier>{ objectName: 'general', propertyName: 'filterValues' },
        defaultValue: <DataViewObjectPropertyIdentifier>{ objectName: 'general', propertyName: 'defaultValue' },
        selfFilterEnabled: <DataViewObjectPropertyIdentifier>{ objectName: 'general', propertyName: 'selfFilterEnabled' },
        // store version
        version: <DataViewObjectPropertyIdentifier>{ objectName: 'general', propertyName: 'version' },
    };

    export interface HierarchySlicerSettings {
        general: {
            rows: number;
            singleselect: boolean;
            showDisabled: string;
            outlineColor: string;
            outlineWeight: number;
            selfFilterEnabled: boolean;
            version: number;
        };
        margin: IMargin;
        header: {
            borderBottomWidth: number;
            show: boolean;
            outline: string;
            fontColor: string;
            background: string;
            textSize: number;
            outlineColor: string;
            outlineWeight: number;
            title: string;
        };
        headerText: {
            marginLeft: number;
            marginTop: number;
        };
        slicerText: {
            textSize: number;
            height: number;
            width: number;
            fontColor: string;
            hoverColor: string;
            selectedColor: string;
            unselectedColor: string;
            disabledColor: string;
            marginLeft: number;
            outline: string;
            background: string;
            transparency: number;
            outlineColor: string;
            outlineWeight: number;
            borderStyle: string;
        };
        slicerItemContainer: {
            marginTop: number;
            marginLeft: number;
        };
    }

    export interface HierarchySlicerDataPoint extends SelectableDataPoint {
        value: string;
        tooltip: string;
        level: number;
        mouseOver?: boolean;
        mouseOut?: boolean;
        isSelectAllDataPoint?: boolean;
        selectable?: boolean;
        id: data.SQExpr;
        isLeaf: boolean;
        isExpand: boolean;
        isHidden: boolean;
        ownId: string;
        parentId: string;
        order: number;
    }

    export interface HierarchySlicerData {
        dataPoints: HierarchySlicerDataPoint[];
        hasSelectionOverride?: boolean;
        settings: HierarchySlicerSettings;
        levels: number;
    }

    export interface HierarchySlicerBehaviorOptions {
        hostServices: IVisualHostServices;
        expanders: D3.Selection;
        slicerContainer: D3.Selection;
        slicerItemContainers: D3.Selection;
        slicerItemLabels: D3.Selection;
        slicerItemInputs: D3.Selection;
        slicerClear: D3.Selection;
        slicerExpand: D3.Selection;
        slicerCollapse: D3.Selection;
        dataPoints: HierarchySlicerDataPoint[];
        interactivityService: IInteractivityService;
        slicerSettings: HierarchySlicerSettings;
        levels: number;
    }

    export class HierarchySlicer implements IVisual {
        public static capabilities: VisualCapabilities = {
            dataRoles: [{
                name: 'Fields',
                kind: powerbi.VisualDataRoleKind.Grouping,
                displayName: 'Fields'
            },
                {
                    name: 'Values',
                    kind: VisualDataRoleKind.Measure,
                    displayName: 'Values',
                }],
            dataViewMappings: [{
                conditions: [{
                    'Values': { min: 0, max: 1 }
                }],
                table: {
                    rows: {
                        for: { in: 'Fields' },
                        dataReductionAlgorithm: { bottom: { count: 4000 } }
                    },
                }
            }],
            objects: {
                general: {
                    displayName: 'General',
                    properties: {
                        filter: {
                            type: { filter: {} }
                        },
                        filterValues: {
                            type: { text: true }
                        },
                        expanded: {
                            type: { text: true }
                        },
                        hidden: {
                            type: { text: true }
                        },
                        defaultValue: {
                            type: { expression: { defaultValue: true } },
                        },
                        formatString: {
                            type: {
                                formatting: { formatString: true }
                            },
                        },
                        selfFilter: {
                            type: { filter: { selfFilter: true } },
                        },
                        selfFilterEnabled: {
                            type: { operations: { searchEnabled: true } }
                        },
                        version: {
                            type: { numeric: true }
                        },
                    },
                },
                selection: {
                    displayName: 'Selection',
                    properties: {
                        singleSelect: {
                            displayName: 'Single Select',
                            type: { bool: true }
                        }
                    },
                },
                header: {
                    displayName: 'Header',
                    properties: {
                        title: {
                            displayName: 'Title',
                            type: { text: true }
                        },
                        fontColor: {
                            displayName: 'Font color',
                            description: 'Font color of the title',
                            type: { fill: { solid: { color: true } } }
                        },
                        background: {
                            displayName: 'Background',
                            type: { fill: { solid: { color: true } } }
                        },
                        textSize: {
                            displayName: 'Text Size',
                            type: { formatting: { fontSize: true } }
                        },
                    },
                },
                items: {
                    displayName: 'Items',
                    properties: {
                        fontColor: {
                            displayName: 'Font color',
                            description: 'Font color of the cells',
                            type: { fill: { solid: { color: true } } }
                        },
                        selectedColor: {
                            displayName: 'Select color',
                            description: 'Font color of the selected cells',
                            type: { fill: { solid: { color: true } } }
                        },
                        background: {
                            displayName: 'Background',
                            type: { fill: { solid: { color: true } } }
                        },
                        textSize: {
                            displayName: 'Text Size',
                            type: { formatting: { fontSize: true } }
                        },
                    },
                }
            },
            supportsHighlight: true,
            suppressDefaultTitle: true,
            filterMappings: {
                measureFilter: { targetRoles: ['Fields'] },
            },
            sorting: {
                default: {},
            },

        };

        public static formatStringProp: DataViewObjectPropertyIdentifier = {
            objectName: "general",
            propertyName: "formatString",
        };

        private element: JQuery;
        private searchHeader: JQuery;
        private searchInput: JQuery;
        private behavior: HierarchySlicerWebBehavior;
        private selectionManager: SelectionManager;
        private viewport: IViewport;
        private hostServices: IVisualHostServices;
        private interactivityService: IInteractivityService;
        private settings: HierarchySlicerSettings;
        private dataView: DataView;
        private data: HierarchySlicerData;
        private treeView: ITreeView;
        private margin: IMargin;
        private maxLevels: number;
        private waitingForData: boolean;
        private slicerContainer: D3.Selection;
        private slicerHeader: D3.Selection;
        private slicerBody: D3.Selection;

        public static DefaultFontFamily: string = 'Segoe UI, Tahoma, Verdana, Geneva, sans-serif';
        public static DefaultFontSizeInPt: number = 11;

        private static Container: ClassAndSelector = createClassAndSelector('slicerContainer');
        private static Body: ClassAndSelector = createClassAndSelector('slicerBody');
        private static ItemContainer: ClassAndSelector = createClassAndSelector('slicerItemContainer');
        private static ItemContainerExpander: ClassAndSelector = createClassAndSelector('slicerItemContainerExpander');
        private static ItemContainerChild: ClassAndSelector = createClassAndSelector('slicerItemContainerChild');
        private static LabelText: ClassAndSelector = createClassAndSelector('slicerText');
        private static CountText: ClassAndSelector = createClassAndSelector('slicerCountText');
        private static Checkbox: ClassAndSelector = createClassAndSelector('checkbox');
        private static Header: ClassAndSelector = createClassAndSelector('slicerHeader');
        private static HeaderText: ClassAndSelector = createClassAndSelector('headerText');
        private static Collapse: ClassAndSelector = createClassAndSelector('collapse');
        private static Expand: ClassAndSelector = createClassAndSelector('expand');
        private static Clear: ClassAndSelector = createClassAndSelector('clear');
        private static Input: ClassAndSelector = createClassAndSelector('slicerCheckbox');

        public static DefaultSlicerSettings(): HierarchySlicerSettings {
            return {
                general: {
                    rows: 0,
                    singleselect: true,
                    showDisabled: "",
                    outlineColor: '#808080',
                    outlineWeight: 1,
                    selfFilterEnabled: false,
                    version: 801, // 0.08.01
                },
                margin: {
                    top: 50,
                    bottom: 50,
                    right: 50,
                    left: 50
                },
                header: {
                    borderBottomWidth: 1,
                    show: true,
                    outline: 'BottomOnly',
                    fontColor: '#666666',
                    background: undefined,
                    textSize: 10,
                    outlineColor: '#a6a6a6',
                    outlineWeight: 1,
                    title: '',
                },
                headerText: {
                    marginLeft: 8,
                    marginTop: 0
                },
                slicerText: {
                    textSize: 10,
                    height: 18,
                    width: 0,
                    fontColor: '#666666',
                    hoverColor: '#212121',
                    selectedColor: '#333333',
                    unselectedColor: '#ffffff',
                    disabledColor: 'grey',
                    marginLeft: 8,
                    outline: 'Frame',
                    background: undefined,
                    transparency: 0,
                    outlineColor: '#000000',
                    outlineWeight: 1,
                    borderStyle: 'Cut',
                },
                slicerItemContainer: {
                    // The margin is assigned in the less file. This is needed for the height calculations.
                    marginTop: 5,
                    marginLeft: 0,
                },
            };
        }

        public converter(dataView: DataView, searchText: string): HierarchySlicerData {
            if (!dataView ||
                !dataView.table ||
                !dataView.table.rows ||
                !(dataView.table.rows.length > 0) ||
                !dataView.table.columns ||
                !(dataView.table.columns.length > 0)) {
                return {
                    dataPoints: [],
                    settings: null,
                    levels: null,
                };
            }

            var rows = dataView.table.rows;
            var columns = dataView.table.columns;
            var levels = rows[0].length - 1;
            var dataPoints = [];
            var defaultSettings: HierarchySlicerSettings = HierarchySlicer.DefaultSlicerSettings();
            var identityValues = [];
            var selectedIds = [];
            var expandedIds = [];
            var selectionFilter;
            var order: number = 0;

            var objects = dataView.metadata.objects;

            defaultSettings.general.singleselect = DataViewObjects.getValue<boolean>(objects, hierarchySlicerProperties.selection.singleselect, defaultSettings.general.singleselect);
            defaultSettings.header.title = DataViewObjects.getValue<string>(objects, hierarchySlicerProperties.header.title, dataView.metadata.columns[0].displayName);
            selectedIds = DataViewObjects.getValue<string>(objects, hierarchySlicerProperties.filterValuePropertyIdentifier, "").split(',');
            expandedIds = DataViewObjects.getValue<string>(objects, hierarchySlicerProperties.expandedValuePropertyIdentifier, "").split(',');

            defaultSettings.general.selfFilterEnabled = DataViewObjects.getValue<boolean>(objects, hierarchySlicerProperties.selfFilterEnabled, defaultSettings.general.selfFilterEnabled);
            
            for (var r = 0; r < rows.length; r++) {
                var parentExpr = null;
                var parentId: string = '';

                for (var c = 0; c < rows[r].length; c++) {
                    var format = dataView.table.columns[c].format;
                    var dataType: ValueTypeDescriptor = dataView.table.columns[c].type
                    var labelValue: string = valueFormatter.format(rows[r][c], format);
                    labelValue = labelValue === null ? "(blank)" : labelValue;

                    var value: data.SQConstantExpr;
                    if (rows[r][c] === null) {
                        value = powerbi.data.SQExprBuilder.nullConstant();
                    } else {
                        if (dataType.text) {
                            value = powerbi.data.SQExprBuilder.text(rows[r][c]);
                        } else if (dataType.integer) {
                            value = powerbi.data.SQExprBuilder.integer(rows[r][c]);
                        } else if (dataType.numeric) {
                            value = powerbi.data.SQExprBuilder.double(rows[r][c]);
                        } else if (dataType.bool) {
                            value = powerbi.data.SQExprBuilder.boolean(rows[r][c]);
                        } else if (dataType.dateTime) {
                            value = powerbi.data.SQExprBuilder.dateTime(rows[r][c]);
                        } else {
                            value = powerbi.data.SQExprBuilder.text(rows[r][c]);
                        }
                    }
                    var filterExpr = powerbi.data.SQExprBuilder.compare(
                        powerbi.data.QueryComparisonKind.Equal,
                        dataView.table.columns[c].expr ?
                            <powerbi.data.SQExpr>dataView.table.columns[c].expr :
                            <powerbi.data.SQExpr>dataView.categorical.categories[0].identityFields[c], // Needed for PBI May 2016
                        value);

                    if (c > 0) {
                        parentExpr = powerbi.data.SQExprBuilder.and(parentExpr, filterExpr);
                    }
                    else {
                        parentId = "";
                        parentExpr = filterExpr;
                    }
                    var ownId = parentId + (parentId === "" ? "" : '_') + labelValue.replace(/,/g, '') + '-' + c;
                    var isLeaf = c === rows[r].length - 1;

                    var dataPoint = {
                        identity: null, //identity,
                        selected: selectedIds.filter((d) => d === ownId).length > 0,
                        value: labelValue,
                        tooltip: labelValue,
                        level: c,
                        selectable: true,
                        partialSelected: false,
                        isLeaf: isLeaf,
                        isExpand: expandedIds === [] ? false : expandedIds.filter((d) => d === ownId).length > 0 || false,
                        isHidden: c === 0 ? false : true, // Default true. Real status based on the expanded properties of parent(s)
                        id: filterExpr,
                        ownId: ownId,
                        parentId: parentId,
                        order: order++,
                    };

                    parentId = ownId;

                    if (identityValues.indexOf(ownId) === -1) {
                        identityValues.push(ownId);
                        dataPoints.push(dataPoint);
                    }
                }
            }

            if (defaultSettings.general.selfFilterEnabled && searchText) { // Threasholt value toevoegen
                searchText = searchText.toLowerCase();
                var filteredDataPoints = dataPoints.filter((d) => d.value.toLowerCase().indexOf(searchText) >= 0);
                var unique = {};

                for (var i in filteredDataPoints) {
                    unique[filteredDataPoints[i].ownId] = 0;
                }

                for (var l = levels; l >= 1; l--) {
                    var levelDataPoints = filteredDataPoints.filter((d) => d.level === l);
                    var missingParents = {};

                    for (var i in levelDataPoints) {
                        if (typeof (unique[levelDataPoints[i].parentId]) == "undefined") {
                            missingParents[levelDataPoints[i].parentId] = 0;
                        }
                        unique[levelDataPoints[i].parentId] = 0;
                    }

                    for (var mp in missingParents) {
                        filteredDataPoints.push(dataPoints.filter(d => d.ownId === mp)[0]);
                    }
                }

                dataPoints = filteredDataPoints.filter((value, index, self) => self.indexOf(value) === index)
                    .sort((d1, d2) => d1.order - d2.order); // set new dataPoints based on the searchText

                var parent = {};
                for (var dp in dataPoints) {
                    if (typeof (parent[dataPoints[dp].parentId]) == "undefined") {
                        parent[dataPoints[dp].parentId] = 0;
                    }
                }
                dataPoints.map(d => d.isLeaf = parent[d.ownId] !== 0)
            } else {
                dataPoints = dataPoints.sort((d1, d2) => d1.order - d2.order); // set new dataPoints based on the searchText
            }

            // Set isHidden property
            var parentRootNodes = [];
            var parentRootNodesTemp = [];
            var parentRootNodesTotal = [];
            for (var l = 0; l < levels; l++) {
                var expandedRootNodes = dataPoints.filter((d) => d.isExpand && d.level === l);
                if (expandedRootNodes.length > 0) {
                    for (var n = 0; n < expandedRootNodes.length; n++) {
                        parentRootNodesTemp = parentRootNodes.filter((p) => expandedRootNodes[n].parentId === p.ownId); //Is parent expanded?                        
                        if (l === 0 || (parentRootNodesTemp.length > 0)) {
                            parentRootNodesTotal = parentRootNodesTotal.concat(expandedRootNodes[n]);
                            dataPoints.filter((d) => d.parentId === expandedRootNodes[n].ownId && d.level === l + 1).forEach((d) => d.isHidden = false);
                        }
                    }
                }
                parentRootNodes = parentRootNodesTotal;
            }

            return {
                dataPoints: dataPoints,
                settings: defaultSettings,
                levels: levels,
                hasSelectionOverride: true,
            };
        }

        public constructor(options?: any) {
            if (options) {
                if (options.margin) {
                    this.margin = options.margin;
                }
                if (options.behavior) {
                    this.behavior = options.behavior;
                }
            }

            if (!this.behavior) {
                this.behavior = new HierarchySlicerWebBehavior();
            }
        }

        public init(options: VisualInitOptions): void {
            var hostServices = this.hostServices = options.host;
            this.element = options.element;
            this.viewport = options.viewport;
            this.hostServices = options.host;
            this.hostServices.canSelect = () => true;
            this.settings = HierarchySlicer.DefaultSlicerSettings();

            this.selectionManager = new SelectionManager({ hostServices: options.host });
            this.selectionManager.clear();

            if (this.behavior)
                this.interactivityService = createInteractivityService(hostServices);

            this.slicerContainer = d3.select(this.element.get(0))
                .append('div')
                .classed(HierarchySlicer.Container.class, true);

            this.slicerHeader = this.slicerContainer
                .append('div')
                .classed(HierarchySlicer.Header.class, true);

            this.slicerHeader
                .append('span')
                .classed(HierarchySlicer.Clear.class, true)
                .attr('title', 'Clear')

            this.slicerHeader
                .append('span')
                .classed(HierarchySlicer.Expand.class, true)
                .classed(HierarchySlicer.Clear.class, true)
                .attr('title', 'Expand all')

            this.slicerHeader
                .append('span')
                .classed(HierarchySlicer.Collapse.class, true)
                .classed(HierarchySlicer.Clear.class, true)
                .attr('title', 'Collapse all')

            this.slicerHeader
                .append('div')
                .classed(HierarchySlicer.HeaderText.class, true);

            this.createSearchHeader($(this.slicerHeader.node()));

            this.slicerBody = this.slicerContainer
                .append('div')
                .classed(HierarchySlicer.Body.class, true)
                .style({
                    'height': PixelConverter.toString(this.viewport.height),
                    'width': PixelConverter.toString(this.viewport.width),
                });

            var rowEnter = (rowSelection: D3.Selection) => {
                this.onEnterSelection(rowSelection);
            };

            var rowUpdate = (rowSelection: D3.Selection) => {
                this.onUpdateSelection(rowSelection, this.interactivityService);
            };

            var rowExit = (rowSelection: D3.Selection) => {
                rowSelection.remove();
            };

            var treeViewOptions: ListViewOptions = {
                rowHeight: this.getRowHeight(),
                enter: rowEnter,
                exit: rowExit,
                update: rowUpdate,
                loadMoreData: () => this.onLoadMoreData(),
                scrollEnabled: true,
                viewport: this.getBodyViewport(this.viewport),
                baseContainer: this.slicerBody,
                isReadMode: () => {
                    return (this.hostServices.getViewMode() !== ViewMode.Edit);
                }
            };

            this.treeView = TreeViewFactory.createListView(treeViewOptions);
        }

        public update(options: VisualUpdateOptions): void {
            this.viewport = options.viewport;
            this.dataView = options.dataViews ? options.dataViews[0] : undefined;

            if (options.viewport.height === this.viewport.height
                && options.viewport.width === this.viewport.width) {
                this.waitingForData = false;
            }

            this.updateInternal(false);

            this.checkUpdate();
        }

        public onDataChanged(options: VisualDataChangedOptions): void {
            var dataViews = options.dataViews;

            if (_.isEmpty(dataViews)) {
                return;
            }

            var existingDataView = this.dataView;
            this.dataView = dataViews[0];

            var resetScrollbarPosition = options.operationKind !== VisualDataChangeOperationKind.Append
                && !DataViewAnalysis.hasSameCategoryIdentity(existingDataView, this.dataView);

            this.updateInternal(resetScrollbarPosition);
        }

        public onResizing(viewPort: IViewport) {
            this.viewport = viewPort;
            this.updateInternal(false);
        }

        private updateInternal(resetScrollbar: boolean) {
            this.updateSlicerBodyDimensions();

            var dataView = this.dataView,
                data = this.data = this.converter(dataView, this.searchInput.val())

            this.maxLevels = this.data.levels + 1;

            if (data.dataPoints.length === 0) {
                this.treeView.empty();
                return;
            }

            this.settings = this.data.settings;
            this.updateSettings();

            this.treeView
                .viewport(this.getBodyViewport(this.viewport))
                .rowHeight(this.settings.slicerText.height)
                .data(
                data.dataPoints.filter((d) => !d.isHidden), // Expand/Collapse
                (d: HierarchySlicerDataPoint) => $.inArray(d, data.dataPoints),
                resetScrollbar
                )
                .render();

            this.updateSearchHeader();
        }

        private updateSettings(): void {
            this.updateSelectionStyle();
            this.updateFontStyle();
            this.updateHeaderStyle();
        }

        private checkUpdate() {
            if (!this.dataView ||
                !this.dataView.metadata ||
                !this.dataView.metadata.objects) {
                return
            }
            var objects = this.dataView.metadata.objects;
            var defaultSettings = HierarchySlicer.DefaultSlicerSettings();

            var codeVersion = defaultSettings.general.version;
            var currentVersion = DataViewObjects.getValue(objects, hierarchySlicerProperties.version, defaultSettings.general.version);

            if (codeVersion > currentVersion) {
                var obj: VisualObjectInstancesToPersist = {
                    merge: [
                        <VisualObjectInstance>{
                            objectName: "general",
                            selector: undefined,
                            properties: {
                                version: codeVersion,
                            },
                        }]
                };
                this.hostServices.persistProperties(obj);

                var warnings: IVisualWarning[] = [];
                warnings.push({
                    code: 'NewVersion',
                    getMessages: () => {
                        var visualMessage: IVisualErrorMessage = {
                            message: "Find out what's new at: http://bit.ly/1Uzpp1E",
                            title: '',
                            detail: '',
                        };
                        return visualMessage;
                    }
                });
            }
        }

        private updateSelectionStyle(): void {
            var objects = this.dataView && this.dataView.metadata && this.dataView.metadata.objects;
            if (objects) {
                this.slicerContainer.classed('isMultiSelectEnabled', !DataViewObjects.getValue<boolean>(objects, hierarchySlicerProperties.selection.singleselect, this.settings.general.singleselect));
            }
        }

        private updateFontStyle(): void {
            var objects = this.dataView && this.dataView.metadata && this.dataView.metadata.objects;
            if (objects) {
                this.settings.slicerText.fontColor = DataViewObjects.getFillColor(objects, hierarchySlicerProperties.items.fontColor, this.settings.slicerText.fontColor);
                this.settings.slicerText.selectedColor = DataViewObjects.getFillColor(objects, hierarchySlicerProperties.items.selectedColor, this.settings.slicerText.selectedColor);
                this.settings.slicerText.background = DataViewObjects.getFillColor(objects, hierarchySlicerProperties.items.background, this.settings.slicerText.background);
                this.settings.slicerText.textSize = DataViewObjects.getValue<number>(objects, hierarchySlicerProperties.items.textSize, this.settings.slicerText.textSize);
            }
        }

        private updateHeaderStyle(): void {
            var objects = this.dataView && this.dataView.metadata && this.dataView.metadata.objects;
            if (objects) {
                this.settings.header.fontColor = DataViewObjects.getFillColor(objects, hierarchySlicerProperties.header.fontColor, this.settings.header.fontColor);
                this.settings.header.background = DataViewObjects.getFillColor(objects, hierarchySlicerProperties.header.background, this.settings.header.background);
                this.settings.header.textSize = DataViewObjects.getValue<number>(objects, hierarchySlicerProperties.header.textSize, this.settings.header.textSize);
            }
        }

        private updateSlicerBodyDimensions(): void {
            var slicerViewport: IViewport = this.getBodyViewport(this.viewport);
            this.slicerBody
                .style({
                    'height': PixelConverter.toString(slicerViewport.height),
                    'width': '100%',
                });
        }

        private onEnterSelection(rowSelection: D3.Selection): void {
            var settings = this.settings;

            var treeItemElementParent = rowSelection.append('li')
                .classed(HierarchySlicer.ItemContainer.class, true)
                .style({ 'background-color': settings.slicerText.background });

            // Expand/collapse
            if (this.maxLevels > 1) {
                treeItemElementParent.each(function (d: HierarchySlicerDataPoint, i: number) {
                    var item = d3.select(this);
                    item.append('div')
                        .classed(HierarchySlicer.ItemContainerExpander.class, true)
                        .append('i')
                        .classed("collapse-icon", true)
                        .classed("expanded-icon", d.isExpand)
                        .style("visibility", d.isLeaf ? "hidden" : "visible");
                });
            }

            var treeItemElement = treeItemElementParent.append('div')
                .classed(HierarchySlicer.ItemContainerChild.class, true);

            var labelElement = treeItemElement.append('div')
                .classed(HierarchySlicer.Input.class, true);

            labelElement.append('input')
                .attr('type', 'checkbox');

            labelElement.append('span')
                .classed(HierarchySlicer.Checkbox.class, true);

            treeItemElement.each(function (d: HierarchySlicerDataPoint, i: number) {
                var item = d3.select(this);
                item.append('span')
                    .classed(HierarchySlicer.LabelText.class, true)
                    .style({
                        'color': settings.slicerText.fontColor,
                        'font-size': PixelConverter.fromPoint(settings.slicerText.textSize)
                    });
            });
            var maxLevel = this.maxLevels;

            treeItemElementParent.each(function (d: HierarchySlicerDataPoint, i: number) {
                var item = d3.select(this);
                item.style('padding-left', (maxLevel === 1 ? 8 : (d.level * 15)) + 'px');
            });
        }

        private onUpdateSelection(rowSelection: D3.Selection, interactivityService: IInteractivityService): void {
            var settings: HierarchySlicerSettings = this.settings;
            var data = this.data;
            if (data) {
                if (settings.header.show) {
                    this.slicerHeader.style('display', 'block');
                } else {
                    this.slicerHeader.style('display', 'none');
                }
                this.slicerHeader.select(HierarchySlicer.HeaderText.selector)
                    .text(settings.header.title.trim()) //this.slicerHeader
                    .style({
                        'color': settings.header.fontColor,
                        'background-color': settings.header.background,
                        'border-style': 'solid',
                        'border-color': settings.general.outlineColor,
                        'border-width': this.getBorderWidth(settings.header.outline, settings.header.outlineWeight),
                        'font-size': PixelConverter.fromPoint(settings.header.textSize),
                    });

                this.slicerBody
                    .classed('slicerBody', true);

                var slicerText = rowSelection.selectAll(HierarchySlicer.LabelText.selector);

                slicerText.text((d: HierarchySlicerDataPoint) => {
                    return d.value;
                });

                if (interactivityService && this.slicerBody) {
                    var body = this.slicerBody.attr('width', this.viewport.width);
                    var expanders = body.selectAll(HierarchySlicer.ItemContainerExpander.selector);
                    var slicerItemContainers = body.selectAll(HierarchySlicer.ItemContainerChild.selector);
                    var slicerItemLabels = body.selectAll(HierarchySlicer.LabelText.selector);
                    var slicerItemInputs = body.selectAll(HierarchySlicer.Input.selector);
                    var slicerClear = this.slicerHeader.select(HierarchySlicer.Clear.selector);
                    var slicerExpand = this.slicerHeader.select(HierarchySlicer.Expand.selector);
                    var slicerCollapse = this.slicerHeader.select(HierarchySlicer.Collapse.selector);

                    var behaviorOptions: HierarchySlicerBehaviorOptions = {
                        hostServices: this.hostServices,
                        dataPoints: data.dataPoints,
                        expanders: expanders,
                        slicerContainer: this.slicerContainer,
                        slicerItemContainers: slicerItemContainers,
                        slicerItemLabels: slicerItemLabels,
                        slicerItemInputs: slicerItemInputs,
                        slicerClear: slicerClear,
                        slicerExpand: slicerExpand,
                        slicerCollapse: slicerCollapse,
                        interactivityService: interactivityService,
                        slicerSettings: data.settings,
                        levels: data.levels,
                    };

                    try { // strange bug in PBI May 2016 craches
                        interactivityService.bind(
                            data.dataPoints,
                            this.behavior,
                            behaviorOptions,
                            {
                                overrideSelectionFromData: true,
                                hasSelectionOverride: data.hasSelectionOverride
                            });
                    } catch (e) {
                    }

                    this.behavior.styleSlicerInputs(
                        rowSelection.select(HierarchySlicer.ItemContainerChild.selector),
                        interactivityService.hasSelection());
                }
                else {
                    this.behavior.styleSlicerInputs(
                        rowSelection.select(HierarchySlicer.ItemContainerChild.selector),
                        false);
                }

            }
        }

        private onLoadMoreData(): void {
            if (!this.waitingForData && this.dataView.metadata && this.dataView.metadata.segment) {
                this.hostServices.loadMoreData();
                this.waitingForData = true;
            }
        }

        public static getTextProperties(textSize?: number): TextProperties {
            return <TextProperties>{
                fontFamily: HierarchySlicer.DefaultFontFamily,
                fontSize: PixelConverter.fromPoint(textSize || HierarchySlicer.DefaultFontSizeInPt),
            };
        }

        private getHeaderHeight(): number {
            return TextMeasurementService.estimateSvgTextHeight(
                HierarchySlicer.getTextProperties(this.settings.header.textSize));
        }

        private getRowHeight(): number {
            return TextMeasurementService.estimateSvgTextHeight(
                HierarchySlicer.getTextProperties(this.settings.slicerText.textSize));
        }

        private getBodyViewport(currentViewport: IViewport): IViewport {
            var settings = this.settings;
            var headerHeight;
            var slicerBodyHeight;
            if (settings) {
                headerHeight = settings.header.show ? this.getHeaderHeight() : 0;
                slicerBodyHeight = currentViewport.height - (headerHeight + settings.header.borderBottomWidth);
            } else {
                headerHeight = 0;
                slicerBodyHeight = currentViewport.height - (headerHeight + 1);
            }
            return {
                height: slicerBodyHeight,
                width: currentViewport.width
            };
        }

        private getBorderWidth(outlineElement: string, outlineWeight: number): string {
            switch (outlineElement) {
                case 'None':
                    return '0px';
                case 'BottomOnly':
                    return '0px 0px ' + outlineWeight + 'px 0px';
                case 'TopOnly':
                    return outlineWeight + 'px 0px 0px 0px';
                case 'TopBottom':
                    return outlineWeight + 'px 0px ' + outlineWeight + 'px 0px';
                case 'LeftRight':
                    return '0px ' + outlineWeight + 'px 0px ' + outlineWeight + 'px';
                case 'Frame':
                    return outlineWeight + 'px';
                default:
                    return outlineElement.replace("1", outlineWeight.toString());
            }
        }

        private createSearchHeader(container: JQuery): void {
            this.searchHeader = $("<div>")
                .appendTo(container)
                .addClass("searchHeader")
                .addClass("collapsed");

            var counter = 0;
            $("<div>").appendTo(this.searchHeader)
                .attr("title", "Search")
                .addClass("powervisuals-glyph")
                .addClass("search")
                .on("click", () => this.hostServices.persistProperties(<VisualObjectInstancesToPersist>{
                    merge: [{
                        objectName: "general",
                        selector: null,
                        properties: {
                            counter: counter++
                        }
                    }]
                }));

            this.searchInput = $("<input>").appendTo(this.searchHeader)
                .attr("type", "text")
                .attr("drag-resize-disabled", "true")
                .addClass("searchInput")
                .on("input", () => this.hostServices.persistProperties(<VisualObjectInstancesToPersist>{
                    merge: [{
                        objectName: "general",
                        selector: null,
                        properties: {
                            counter: counter++
                        }
                    }]
                }));

            $("<div>").appendTo(this.searchHeader)
                .attr("title", "Delete")
                .addClass("delete glyphicon pbi-glyph-close glyph-micro")
                .addClass("delete")
                .on("click", () => {
                    this.searchInput[0].value = "";
                    this.hostServices.persistProperties(<VisualObjectInstancesToPersist>{
                        merge: [{
                            objectName: "general",
                            selector: null,
                            properties: {
                                counter: counter++
                            }
                        }]
                    })
                });
        }

        private updateSearchHeader(): void {
            this.searchHeader.toggleClass("show", this.settings.general.selfFilterEnabled);
            this.searchHeader.toggleClass("collapsed", !this.settings.general.selfFilterEnabled);
        }
        public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstance[] {
            var instances: VisualObjectInstance[] = [];
            var objects = this.dataView.metadata.objects;

            switch (options.objectName) {
                case "selection":
                    var selectionOptions: VisualObjectInstance = {
                        objectName: "selection",
                        displayName: "Selection",
                        selector: null,
                        properties: {
                            singleSelect: DataViewObjects.getValue<boolean>(objects, hierarchySlicerProperties.selection.singleselect, this.settings.general.singleselect),
                        }
                    };
                    instances.push(selectionOptions);
                    break;
                case "header":
                    var headerOptions: VisualObjectInstance = {
                        objectName: "header",
                        displayName: "Header",
                        selector: null,
                        properties: {
                            title: DataViewObjects.getValue<string>(objects, hierarchySlicerProperties.header.title, this.settings.header.title),
                            fontColor: DataViewObjects.getFillColor(objects, hierarchySlicerProperties.header.fontColor, this.settings.header.fontColor),
                            background: DataViewObjects.getFillColor(objects, hierarchySlicerProperties.header.background, this.settings.header.background),
                            textSize: DataViewObjects.getValue<number>(objects, hierarchySlicerProperties.header.textSize, this.settings.header.textSize),
                        }
                    };
                    instances.push(headerOptions);
                    break;
                case "items":
                    var items: VisualObjectInstance = {
                        objectName: "items",
                        displayName: "Items",
                        selector: null,
                        properties: {
                            fontColor: DataViewObjects.getFillColor(objects, hierarchySlicerProperties.items.fontColor, this.settings.slicerText.fontColor),
                            selectedColor: DataViewObjects.getFillColor(objects, hierarchySlicerProperties.items.selectedColor, this.settings.slicerText.selectedColor),
                            background: DataViewObjects.getFillColor(objects, hierarchySlicerProperties.items.background, this.settings.slicerText.background),
                            textSize: DataViewObjects.getValue<number>(objects, hierarchySlicerProperties.items.textSize, this.settings.slicerText.textSize),
                        }
                    }
                    instances.push(items);
                    break;
            }

            return instances;
        }
    }
}