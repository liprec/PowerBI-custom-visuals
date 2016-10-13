/*
* 
* Copyright (c) 2016 Jan Pieter Posthuma
* 
* All rights reserved.
* 
* MIT License.
* 
* Permission is hereby granted, free of charge, to any person obtaining a copy
*  of this software and associated documentation files (the "Software"), to deal
*  in the Software without restriction, including without limitation the rights
*  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
*  copies of the Software, and to permit persons to whom the Software is
*  furnished to do so, subject to the following conditions:
* 
* The above copyright notice and this permission notice shall be included in
*  all copies or substantial portions of the Software.
* 
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
*  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
*  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
*  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
*  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
*  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
*  THE SOFTWARE.
*/
module powerbi.extensibility.visual {
    import ClassAndSelector = jsCommon.CssConstants.ClassAndSelector;
    import createClassAndSelector = jsCommon.CssConstants.createClassAndSelector;
    import PixelConverter = jsCommon.PixelConverter;
    import valueFormatter = powerbi.visuals.valueFormatter;

    export interface TimeAxisSettings {
        play: {
            playType: number;
            stepDuration: number;
            totalDuration: number;
        };
        playLabel: {
            fontSize: number;
        };
    }

    export interface TimeAxisDataPoint  {
        selectionId: ISelectionId;
        value: string;
        label: string;
    }

    export interface TimeAxisData {
        dataPoints: TimeAxisDataPoint[],
        settings: TimeAxisSettings
    }

    export enum PlayType {
        StepDuration,
        TotalDuration
    }

    export class TimeAxis implements IVisual {        
        private canvas: d3.Selection<HTMLElement>;
        private valueLabel: d3.Selection<HTMLElement>;
        private playButtonBase: d3.Selection<HTMLElement>;
        private playButton: d3.Selection<HTMLElement>;
        private playAxisBase: d3.Selection<HTMLElement>;
        private playAxis: d3.Selection<HTMLElement>;
        private playAxisSliderBase: d3.Selection<HTMLElement>;
        private playAxisSlider: d3.Selection<HTMLElement>;
        
        private selectionBuilder: ISelectionIdBuilder;
        private selectionManager: ISelectionManager;
        private hostService: IVisualHost;
        private viewport: IViewport; 
        private dataView: DataView;
        private data: TimeAxisData;
        private settings: TimeAxisSettings;

        private timerId: number;
        private stepAxis: number;
        private step: number;
        
        private static VisualClass: ClassAndSelector = createClassAndSelector("timeAxis");
        private static Canvas: ClassAndSelector = createClassAndSelector("canvas");
        private static PlayButtonBase: ClassAndSelector = createClassAndSelector("playButtonBase");
        private static PlayButton: ClassAndSelector = createClassAndSelector("playButton");
        private static PauseButton: ClassAndSelector = createClassAndSelector("pauseButton");
        private static PlayAxisBase: ClassAndSelector = createClassAndSelector("playAxisBase");
        private static PlayAxis: ClassAndSelector = createClassAndSelector("playAxis");
        private static PlayAxisSliderBase: ClassAndSelector = createClassAndSelector("playAxisSliderBase");
        private static PlayAxisSlider: ClassAndSelector = createClassAndSelector("playAxisSlider");
        private static ValueLabel: ClassAndSelector = createClassAndSelector("valueLabel");

        private playStatus: boolean = false;

        private filter: string = "{\"fromValue\":{\"items\":{\"t\":{\"entity\":\"TimelineTable\"}}},\"whereItems\":[{\"condition\":{\"_kind\":13,\"comparison\":0,\"left\":{\"_kind\":2,\"source\":{\"_kind\":0,\"entity\":\"TimelineTable\",\"variable\":\"t\"},\"ref\":\"City\"},\"right\":{\"_kind\":17,\"type\":{\"underlyingType\":1,\"category\":null},\"value\":\"Cairo\",\"valueEncoded\":\"'Cairo'\"}}}]}";

        public static DefaultSettings(): TimeAxisSettings {
            return {
                play: {
                    playType: PlayType.StepDuration,
                    stepDuration: 1000,
                    totalDuration: 10
                },
                playLabel: {
                    fontSize: 16
                }
            };
        }

        constructor(options: VisualConstructorOptions) {
            if (!this.canvas) {
                this.canvas =  d3.select(options.element)
                                    .append("div")
                                    .classed(TimeAxis.Canvas.class, true);
            }

            this.valueLabel = this.canvas
                                    .append("div")
                                    .classed(TimeAxis.ValueLabel.class, true);

            this.playButtonBase = this.canvas
                                    .append("div")
                                    .classed(TimeAxis.PlayButtonBase.class, true);
            
            this.playButton = this.playButtonBase
                                    .append("div")
                                    .classed(TimeAxis.PlayButton.class, true);

            this.playAxisBase = this.canvas
                                    .append("div")
                                    .classed(TimeAxis.PlayAxisBase.class, true);

            this.playAxis = this.playAxisBase
                                    .append("div")
                                    .classed(TimeAxis.PlayAxis.class, true);
            
            this.playAxisSliderBase = this.playAxis
                                    .append("div")
                                    .classed(TimeAxis.PlayAxisSliderBase.class, true);

            this.playAxisSlider = this.playAxisSliderBase
                                    .append("div")
                                    .classed(TimeAxis.PlayAxisSlider.class, true);

            this.selectionBuilder = options.host.createSelectionIdBuilder();
            this.selectionManager = options.host.createSelectionManager();
            this.hostService = options.host;
        }

        public update(options: VisualUpdateOptions) {
            if (!options.dataViews || !options.dataViews[0]) {
                this.canvas.each(e => e.remove() );
                return;
            }

            this.viewport = options.viewport;
            this.dataView = options.dataViews ? options.dataViews[0] : undefined;
            
            let data = this.data = this.convertor(this.dataView);
            let settings = this.settings = this.data.settings = TimeAxis.DefaultSettings();
            let dataPoints = this.data.dataPoints;

            if (data.dataPoints.length === 0) {
                return;
            }

            this.stepAxis = 100 / (data.dataPoints.length - 1);

            this.playAxisBase
                .style("width", (this.viewport.width - 40).toString() + "px");

            this.playAxisSliderBase
                .style("width", (this.viewport.width - 48).toString() + "px");

            this.valueLabel
                .text(data.dataPoints[0].label)
                .style("font-size", PixelConverter.fromPoint(this.settings.playLabel.fontSize).toString());

            this.playButtonBase.on("click", () => {
                this.playStatus = !this.playStatus;
                this.playButton
                    .classed(TimeAxis.PlayButton.class, !this.playStatus)
                    .classed(TimeAxis.PauseButton.class, this.playStatus);
                if (this.playStatus) {
                    // Play
                    if (!this.timerId) {                    
                        this.step = 0;
                        //this.selectionManager.select(this.data.dataPoints[this.step].selectionId, false);
                        this.setFilter(this.dataView.metadata, this.filter);

                        this.timerId = setInterval(() => {
                            if ((this.step < (this.data.dataPoints.length - 1)) && this.playStatus) {
                                this.step++;
                                this.playAxisSlider.style("left", (this.stepAxis * this.step).toString() + "%");
                                this.valueLabel.text(this.data.dataPoints[this.step].label);
                                
                                //this.selectionManager.select(this.data.dataPoints[this.step].selectionId, false);
                            } 
                        }, this.settings.play.stepDuration);
                    }
                } else {
                    // Pause
                }
            });

            this.playButtonBase.on("dblclick", () => {
                clearInterval(this.timerId);
                this.timerId = null;
                
                this.playStatus = false;
                this.playAxisSlider.style("left", "0%");
                this.valueLabel.text(this.data.dataPoints[0].label);
                this.playButton
                    .classed(TimeAxis.PlayButton.class, !this.playStatus)
                    .classed(TimeAxis.PauseButton.class, this.playStatus);
                this.selectionManager.clear();
             })
        }

        private convertor(dataView: DataView) : TimeAxisData {
             if (!dataView ||
                !dataView.categorical ||
                !dataView.categorical.categories ||
                !dataView.categorical.categories[0].source) {
                return {
                    dataPoints: [],
                    settings: null
                };
            }
            
            let categories = dataView.categorical.categories[0];
            let values = categories.values;
            let dataPoints: TimeAxisDataPoint[] = [];
            let settings = TimeAxis.DefaultSettings();
            
            for (let v = 0; v < values.length; v++) {

                let format = categories.source.format;
                let dataType: ValueTypeDescriptor = categories.source.type;
                let labelValue: string = valueFormatter.format(values[v], format);
                
                let dataPoint: TimeAxisDataPoint = {
                    selectionId : this.hostService.createSelectionIdBuilder()
                                    .withCategory(categories, v)
                                    .createSelectionId(),
                    value: labelValue,
                    label: labelValue
                }

                dataPoints.push(dataPoint);
            }

            return {
                dataPoints: dataPoints,
                settings: settings
            }
        }

        // Function for retrieving color values
        private setFilter(metadata: DataViewMetadata, value: string): void {
            if(!metadata["object"]) { // check if exist
                let objects: DataViewObjects = void 0; 
                let object: DataViewObject = void 0;
                let filter = value;
                object["filter"] = filter;
                objects["general"] = object;
                metadata.objects = objects;
            }
            // let object = objects["general"];
            // if(object) { // check if exist
            //     let property = object["filter"];
            //     if(property !== undefined) { // check if exist
            //         property = value; // store value
            //     }
            // }
        }
    }
}